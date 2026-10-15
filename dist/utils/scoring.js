/** Rounds to 2 decimals while avoiding floating point artifacts such as 0.30000000000000004. */
export function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
/**
 * Pure scoring function. Correct answers earn `marksPerCorrect`,
 * incorrect answers lose `negativeMarks`, unanswered questions score 0.
 */
export function scoreAnswers(answers, config) {
    let correct = 0;
    let incorrect = 0;
    const grades = answers.map((a) => {
        const isAttempted = a.selectedOption !== null && a.selectedOption !== undefined && a.selectedOption !== '';
        const isCorrect = isAttempted && a.selectedOption === a.correctOption;
        let marksAwarded = 0;
        if (isCorrect) {
            correct += 1;
            marksAwarded = config.marksPerCorrect;
        }
        else if (isAttempted) {
            incorrect += 1;
            marksAwarded = -Math.abs(config.negativeMarks);
        }
        return {
            questionId: a.questionId,
            selectedOption: isAttempted ? a.selectedOption : null,
            correctOption: a.correctOption,
            isCorrect,
            isAttempted,
            marksAwarded: round2(marksAwarded),
        };
    });
    const totalQuestions = answers.length;
    const attempted = correct + incorrect;
    const maximumMarks = round2(totalQuestions * config.marksPerCorrect);
    const totalScore = round2(correct * config.marksPerCorrect - incorrect * Math.abs(config.negativeMarks));
    return {
        totalQuestions,
        attemptedCount: attempted,
        correctCount: correct,
        incorrectCount: incorrect,
        unansweredCount: totalQuestions - attempted,
        totalScore,
        maximumMarks,
        percentage: maximumMarks > 0 ? round2((totalScore / maximumMarks) * 100) : 0,
        accuracy: attempted > 0 ? round2((correct / attempted) * 100) : 0,
        grades,
    };
}
//# sourceMappingURL=scoring.js.map