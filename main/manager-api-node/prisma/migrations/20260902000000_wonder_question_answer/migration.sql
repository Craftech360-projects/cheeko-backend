-- Keep what the child SAID, not only what they were asked.
--
-- The recall opened with "the question you left them with" even when the child
-- had answered it thirty seconds earlier: on prod 2026-09-01 the Daily Ten ended
-- with "if you could build a house out of any food, what would you use?", the
-- child said "Pizza", Quizzy replied about the melted-cheese roof — and the next
-- morning she asked the same question again, because nothing recorded that it
-- had been answered. The child's reply was "Ask the direct question."
--
-- With the answer stored, the recall splits: a question the child answered comes
-- back as a callback to THEIR idea, and only an unanswered one is re-asked.
ALTER TABLE kid_wonder_question
  ADD COLUMN IF NOT EXISTS answer_text TEXT;
