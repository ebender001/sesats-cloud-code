const AI_QUESTION_PROMPT_VERSION = "question-generator-v2";

function buildContextLines({ specialty, topic, difficulty, hasMedia, generatorNotes }) {
  const lines = [];

  if (typeof specialty === "string" && specialty.trim()) {
    lines.push(`Specialty: ${specialty.trim()}`);
  }

  if (typeof topic === "string" && topic.trim()) {
    lines.push(`Topic: ${topic.trim()}`);
  }

  if (typeof difficulty === "string" && difficulty.trim()) {
    lines.push(`Difficulty: ${difficulty.trim()}`);
  }

  if (hasMedia === true) {
    lines.push(
      "Media: The editor expects to upload supporting media later. Do not describe or rely on unseen media, but you may write a stem that can accommodate future visual or video support."
    );
  }

  if (typeof generatorNotes === "string" && generatorNotes.trim()) {
    lines.push(`Special instructions from editor: ${generatorNotes.trim()}`);
  }

  return lines;
}

function buildGenerateQuestionMessages({ sourceText, specialty, topic, difficulty, hasMedia, generatorNotes }) {
  const contextLines = buildContextLines({ specialty, topic, difficulty, hasMedia, generatorNotes });
  const contextBlock = contextLines.length > 0 ? `${contextLines.join("\n")}\n\n` : "";

  return [
    {
      role: "system",
      content:
        "You are generating advanced board-style medical multiple-choice question drafts for sophisticated physician and surgeon learners. " +
        "Transform the user-provided source material into a polished, high-level question that usually tests clinical judgment rather than simple recall. " +
        "Prefer questions about the best next step, most appropriate management, operative strategy, diagnostic sequencing, interpretation of nuanced clinical data, complication prevention or management, or treatment selection when multiple options sound reasonable. " +
        "Avoid elementary recognition questions unless the source idea specifically requires diagnosis discrimination. " +
        "Return exactly 4 or 5 answer options with exactly one correct answer. " +
        "Make distractors plausible, challenging, and reflective of common but incorrect reasoning paths. " +
        "Distractors should not be obviously wrong and should often involve testing, timing, operative approach, medical therapy, surveillance, or contraindicated interventions when appropriate. " +
        "Avoid simplistic or unrelated distractors unless the source scenario truly demands diagnosis discrimination. " +
        "Write a critique of 300 to 500 words that explains why the correct answer is best, why each distractor is wrong, emphasizes the decision-making logic, and notes when a distractor might be appropriate in a different clinical scenario. " +
        "Prioritize up-to-date references and prefer recent guidelines, consensus statements, major trials, or high-quality reviews. " +
        "Provide 1 to 3 real references only when you are highly confident they exist. " +
        "Do not fabricate PMIDs, DOIs, URLs, authors, journals, years, page ranges, or guideline names. " +
        "If you are not highly confident in a reference, omit it rather than inventing it. " +
        "Use complete academic citation formatting in citationText. " +
        "Return JSON only.",
    },
    {
      role: "user",
      content:
        `${contextBlock}Transform this source text into a polished advanced board-level question draft and return it in the required JSON schema:\n\n` +
        sourceText,
    },
  ];
}

module.exports = {
  AI_QUESTION_PROMPT_VERSION,
  buildGenerateQuestionMessages,
};
