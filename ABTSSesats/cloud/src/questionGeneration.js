const https = require("https");
const {
  AI_QUESTION_PROMPT_VERSION,
  buildGenerateQuestionMessages,
} = require("./prompts/generateQuestionPrompt");

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_QUESTION_GENERATOR_MODEL = "gpt-4.1-mini";

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is required.`);
  }

  return value.trim();
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalBoolean(value) {
  return value === true;
}

function requireAuthenticatedUser(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, "Authentication required.");
  }

  return request.user;
}

function requireOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "OPENAI_API_KEY is not configured in the Back4App environment."
    );
  }

  return apiKey.trim();
}

function postJson(url, headers, payload) {
  if (typeof fetch === "function") {
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }).then(async (response) => ({
      status: response.status,
      data: await response.text(),
    }));
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers,
      },
      (response) => {
        let responseBody = "";

        response.on("data", (chunk) => {
          responseBody += chunk;
        });

        response.on("end", () => {
          resolve({
            status: response.statusCode || 0,
            data: responseBody,
          });
        });
      }
    );

    request.on("error", reject);
    request.write(JSON.stringify(payload));
    request.end();
  });
}

function extractOpenAiMessageContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
}

function countWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function normalizeReference(reference) {
  const safeReference =
    reference && typeof reference === "object" && !Array.isArray(reference) ? reference : {};

  return {
    title: normalizeOptionalString(safeReference.title),
    authors: normalizeOptionalString(safeReference.authors),
    journal: normalizeOptionalString(safeReference.journal),
    year:
      safeReference.year === null || safeReference.year === undefined || safeReference.year === ""
        ? null
        : Number.parseInt(String(safeReference.year).trim(), 10) || null,
    volume: normalizeOptionalString(safeReference.volume),
    issue: normalizeOptionalString(safeReference.issue),
    pages: normalizeOptionalString(safeReference.pages),
    pmid: normalizeOptionalString(safeReference.pmid).replace(/\D+/g, ""),
    doi: normalizeOptionalString(safeReference.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
    url: normalizeOptionalString(safeReference.url),
    citationText: normalizeOptionalString(safeReference.citationText),
    note: normalizeOptionalString(safeReference.note),
  };
}

function validateGeneratedOptions(options) {
  if (!Array.isArray(options) || options.length < 4 || options.length > 5) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The AI question generator did not return 4 or 5 answer options."
    );
  }

  const normalizedOptions = options.map((option) => ({
    text: normalizeOptionalString(option?.text),
    isCorrect: Boolean(option?.isCorrect),
  }));

  const correctCount = normalizedOptions.filter((option) => option.isCorrect).length;
  if (correctCount !== 1 || normalizedOptions.some((option) => !option.text)) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The AI question generator returned invalid answer options."
    );
  }

  return normalizedOptions;
}

function validateGeneratedReferences(references) {
  if (!Array.isArray(references) || references.length < 1 || references.length > 3) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The AI question generator must return between 1 and 3 references."
    );
  }

  const normalizedReferences = references.map(normalizeReference);
  const hasInvalidReference = normalizedReferences.some((reference) => {
    const hasRequiredCitationCore =
      reference.title && reference.authors && reference.journal && reference.year;
    const hasIdentifier = Boolean(reference.pmid || reference.doi || reference.url);
    const hasCitationText = Boolean(reference.citationText);

    return !hasRequiredCitationCore || !hasIdentifier || !hasCitationText;
  });

  if (hasInvalidReference) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The AI question generator returned references that were too incomplete to trust."
    );
  }

  return normalizedReferences;
}

function normalizeGeneratedDraft(rawDraft) {
  const safeDraft = rawDraft && typeof rawDraft === "object" && !Array.isArray(rawDraft) ? rawDraft : {};
  const stem = normalizeOptionalString(safeDraft.stem);
  const critique = normalizeOptionalString(safeDraft.critique);
  const options = validateGeneratedOptions(safeDraft.options);
  const references = validateGeneratedReferences(safeDraft.references);

  if (!stem) {
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, "The AI question generator returned an empty stem.");
  }

  if (countWords(critique) < 80) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The AI question generator returned a critique that was too short to be useful."
    );
  }

  return {
    stem,
    critique,
    options,
    references,
    generatedByAI: true,
    aiModel: OPENAI_QUESTION_GENERATOR_MODEL,
    aiPromptVersion: AI_QUESTION_PROMPT_VERSION,
  };
}

Parse.Cloud.define("generateQuestionDraft", async (request) => {
  requireAuthenticatedUser(request);

  const params = request.params || {};
  const sourceText = requireString(params.sourceText, "sourceText");
  const specialty = normalizeOptionalString(params.specialty);
  const topic = normalizeOptionalString(params.topic);
  const difficulty = normalizeOptionalString(params.difficulty);
  const hasMedia = normalizeOptionalBoolean(params.hasMedia);
  const generatorNotes = normalizeOptionalString(params.generatorNotes);
  const apiKey = requireOpenAiApiKey();

  const payload = {
    model: OPENAI_QUESTION_GENERATOR_MODEL,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "generated_question_draft",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            stem: { type: "string" },
            critique: { type: "string" },
            options: {
              type: "array",
              minItems: 4,
              maxItems: 5,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  text: { type: "string" },
                  isCorrect: { type: "boolean" },
                },
                required: ["text", "isCorrect"],
              },
            },
            references: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  authors: { type: "string" },
                  journal: { type: "string" },
                  year: { type: ["number", "null"] },
                  volume: { type: "string" },
                  issue: { type: "string" },
                  pages: { type: "string" },
                  pmid: { type: "string" },
                  doi: { type: "string" },
                  url: { type: "string" },
                  citationText: { type: "string" },
                  note: { type: "string" },
                },
                required: [
                  "title",
                  "authors",
                  "journal",
                  "year",
                  "volume",
                  "issue",
                  "pages",
                  "pmid",
                  "doi",
                  "url",
                  "citationText",
                  "note",
                ],
              },
            },
          },
          required: ["stem", "critique", "options", "references"],
        },
      },
    },
    messages: buildGenerateQuestionMessages({
      sourceText,
      specialty,
      topic,
      difficulty,
      hasMedia,
      generatorNotes,
    }),
  };

  const response = await postJson(
    OPENAI_API_URL,
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    payload
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The AI question generator could not create a draft right now."
    );
  }

  let parsedResponse;
  try {
    parsedResponse = JSON.parse(response.data);
  } catch (error) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The AI question generator returned an unreadable response."
    );
  }

  const content = extractOpenAiMessageContent(parsedResponse);
  if (!content) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The AI question generator did not return any draft content."
    );
  }

  let generatedDraft;
  try {
    generatedDraft = JSON.parse(content);
  } catch (error) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      "The AI question generator returned invalid JSON."
    );
  }

  return normalizeGeneratedDraft(generatedDraft);
});
