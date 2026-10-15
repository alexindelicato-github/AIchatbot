// ---------------------------------------------------------------------------
// Content moderation service
//
// Screens user-supplied text (chat messages and uploaded file content) with
// the OpenAI Moderation API before it is forwarded to the chat model.
// Fails open: if the moderation call itself errors, the request is allowed
// through and the failure is reported to the caller via `error`.
// ---------------------------------------------------------------------------

export const MODERATION_MODEL = "omni-moderation-latest";

// The moderation endpoint accepts large inputs, but there's no value in
// sending megabytes of uploaded file content — cap what we screen.
const MAX_INPUT_CHARS = 32000;

export function isModerationEnabled() {
  return process.env.MODERATION_ENABLED !== "false";
}

export async function moderateText(openai, text) {
  if (!text || typeof text !== "string") {
    return { flagged: false, categories: [] };
  }

  try {
    const result = await openai.moderations.create({
      model: MODERATION_MODEL,
      input: text.slice(0, MAX_INPUT_CHARS),
    });

    const outcome = result.results?.[0];
    if (!outcome) return { flagged: false, categories: [] };

    const categories = Object.entries(outcome.categories || {})
      .filter(([, hit]) => hit)
      .map(([name]) => name);

    return { flagged: Boolean(outcome.flagged), categories };
  } catch (error) {
    return { flagged: false, categories: [], error: error.message };
  }
}
