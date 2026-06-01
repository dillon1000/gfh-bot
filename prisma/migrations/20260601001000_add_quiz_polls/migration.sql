-- AlterEnum
ALTER TYPE "PollMode" ADD VALUE 'quiz';

-- AlterTable
ALTER TABLE "Poll" ADD COLUMN     "quizQuestions" JSONB;

-- AlterTable
ALTER TABLE "PollVote" ADD COLUMN     "quizAnswers" JSONB;
