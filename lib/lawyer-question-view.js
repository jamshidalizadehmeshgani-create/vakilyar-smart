function toLawyerQuestionView(question) {
  if (!question || typeof question !== "object" || Array.isArray(question)) return null;
  if (typeof question.id !== "string" ||
      typeof question.lawyer_id !== "string" ||
      typeof question.question !== "string") return null;

  return {
    id: question.id,
    question: question.question,
    status: question.status === "answered" ? "answered" : "open",
    created_at: typeof question.created_at === "string" ? question.created_at : null,
    updated_at: typeof question.updated_at === "string" ? question.updated_at : null,
    replies: Array.isArray(question.replies)
      ? question.replies
          .filter(reply => reply && typeof reply === "object" && typeof reply.message === "string")
          .map(reply => ({
            message: reply.message,
            created_at: typeof reply.created_at === "string" ? reply.created_at : null
          }))
      : []
  };
}

module.exports = { toLawyerQuestionView };
