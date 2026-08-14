const { toQuestion, choiceOrderFor, ASK_MODES } = require('../../src/services/quiz.service');

const question = (over = {}) => ({
  id: 100n,
  question_text: 'How many legs does a spider have?',
  answer_text: 'eight',
  accepted_answers: ['8'],
  teach_text: null,
  distractors: [],
  ...over,
});

// The server assigns the Door; the model never picks one (ADR-0005). These
// tests cover what the worker is handed.
describe('Door ladder in the served payload', () => {
  test('a fresh question opens at Door 1', () => {
    const q = toQuestion(question());
    expect(q.ask_mode).toBe('open');
    expect(q.attempt_no).toBe(1);
  });

  test('a returning question also opens at Door 1', () => {
    // Deliberate: quizzy-doors.md settles that a repeat reopens at Door 1, which
    // is why nothing here reads answer history. If that ever changes, this test
    // is the one that should fail first.
    expect(toQuestion(question()).ask_mode).toBe('open');
  });

  test('the ladder is open, choice, guided in that order', () => {
    expect(ASK_MODES).toEqual(['open', 'choice', 'guided']);
  });

  test('Door 2 content ships with the question when a distractor is authored', () => {
    const q = toQuestion(question({ distractors: ['six'] }));
    expect(q.choice_order).toHaveLength(2);
    expect(q.choice_order).toContain('eight');
    expect(q.choice_order).toContain('six');
  });

  test('Door 3 content ships when teach_text is authored', () => {
    const q = toQuestion(question({ teach_text: 'four on each side' }));
    expect(q.teach_text).toBe('four on each side');
  });

  test('unauthored Doors are omitted, not sent empty', () => {
    // The whole bank is in this state until ticket 014 re-levels it. The worker
    // must be able to tell "no Door 2 for this question" from "Door 2 with no
    // options", and skip the rung rather than improvise one.
    const q = toQuestion(question());
    expect('choice_order' in q).toBe(false);
    expect('teach_text' in q).toBe(false);
  });

  test('blank authored content counts as absent', () => {
    const q = toQuestion(question({ teach_text: '   ', distractors: ['', '  '] }));
    expect('teach_text' in q).toBe(false);
    expect('choice_order' in q).toBe(false);
  });

  test('the existing fields are unchanged', () => {
    // The worker parses this payload today; new fields are additive only.
    const q = toQuestion(question());
    expect(q.id).toBe('100');
    expect(q.question_text).toBe('How many legs does a spider have?');
    expect(q.answer_text).toBe('eight');
    expect(q.accepted_answers).toEqual(['8']);
  });
});

describe('choiceOrderFor', () => {
  test('the order is stable for a given question', () => {
    // A shuffle that moved between days would teach position, not the answer:
    // "it was the second one" is right on Monday and wrong on Tuesday.
    const q = question({ distractors: ['six'] });
    expect(choiceOrderFor(q)).toEqual(choiceOrderFor(q));
  });

  test('different questions do not all put the answer first', () => {
    const a = choiceOrderFor(question({ id: 100n, distractors: ['six'] }));
    const b = choiceOrderFor(question({ id: 101n, distractors: ['six'] }));
    expect(a).not.toEqual(b);
    expect(a[0]).toBe('eight');
    expect(b[0]).toBe('six');
  });

  test('no authored distractor means no Door 2', () => {
    // Generating one would be the invented scored content ADR-0005 removed.
    expect(choiceOrderFor(question())).toBeNull();
    expect(choiceOrderFor(question({ distractors: null }))).toBeNull();
  });
});
