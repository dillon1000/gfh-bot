-- DropForeignKey
ALTER TABLE "MuralPixel" DROP CONSTRAINT "MuralPixel_guildId_fkey";

-- DropForeignKey
ALTER TABLE "MuralPlacement" DROP CONSTRAINT "MuralPlacement_guildId_fkey";

-- DropForeignKey
ALTER TABLE "MuralResetProposal" DROP CONSTRAINT "MuralResetProposal_guildId_fkey";

-- DropForeignKey
ALTER TABLE "MuralResetProposal" DROP CONSTRAINT "MuralResetProposal_pollId_fkey";

-- DropForeignKey
ALTER TABLE "DilemmaRound" DROP CONSTRAINT "DilemmaRound_guildId_fkey";

-- DropForeignKey
ALTER TABLE "DilemmaParticipant" DROP CONSTRAINT "DilemmaParticipant_roundId_fkey";

-- DropForeignKey
ALTER TABLE "CorpseGame" DROP CONSTRAINT "CorpseGame_guildId_fkey";

-- DropForeignKey
ALTER TABLE "CorpseParticipant" DROP CONSTRAINT "CorpseParticipant_gameId_fkey";

-- DropForeignKey
ALTER TABLE "CorpseEntry" DROP CONSTRAINT "CorpseEntry_gameId_fkey";

-- DropForeignKey
ALTER TABLE "CorpseEntry" DROP CONSTRAINT "CorpseEntry_participantId_fkey";

-- DropForeignKey
ALTER TABLE "QuipsConfig" DROP CONSTRAINT "QuipsConfig_guildId_fkey";

-- DropForeignKey
ALTER TABLE "QuipsRound" DROP CONSTRAINT "QuipsRound_guildId_fkey";

-- DropForeignKey
ALTER TABLE "QuipsSubmission" DROP CONSTRAINT "QuipsSubmission_roundId_fkey";

-- DropForeignKey
ALTER TABLE "QuipsVote" DROP CONSTRAINT "QuipsVote_roundId_fkey";

-- DropForeignKey
ALTER TABLE "QuipsWeeklyStat" DROP CONSTRAINT "QuipsWeeklyStat_guildId_fkey";

-- DropForeignKey
ALTER TABLE "QuipsLifetimeStat" DROP CONSTRAINT "QuipsLifetimeStat_guildId_fkey";

-- AlterTable
ALTER TABLE "GuildConfig" DROP COLUMN "corpseChannelId",
DROP COLUMN "corpseEnabled",
DROP COLUMN "corpseRunHour",
DROP COLUMN "corpseRunMinute",
DROP COLUMN "corpseRunWeekday",
DROP COLUMN "dilemmaChannelId",
DROP COLUMN "dilemmaCooperationRate",
DROP COLUMN "dilemmaEnabled",
DROP COLUMN "dilemmaRunHour",
DROP COLUMN "dilemmaRunMinute",
DROP COLUMN "muralChannelId",
DROP COLUMN "muralEnabled";

-- DropTable
DROP TABLE "MuralPixel";

-- DropTable
DROP TABLE "MuralPlacement";

-- DropTable
DROP TABLE "MuralResetProposal";

-- DropTable
DROP TABLE "DilemmaRound";

-- DropTable
DROP TABLE "DilemmaParticipant";

-- DropTable
DROP TABLE "CorpseGame";

-- DropTable
DROP TABLE "CorpseParticipant";

-- DropTable
DROP TABLE "CorpseEntry";

-- DropTable
DROP TABLE "QuipsConfig";

-- DropTable
DROP TABLE "QuipsRound";

-- DropTable
DROP TABLE "QuipsSubmission";

-- DropTable
DROP TABLE "QuipsVote";

-- DropTable
DROP TABLE "QuipsWeeklyStat";

-- DropTable
DROP TABLE "QuipsLifetimeStat";

-- DropEnum
DROP TYPE "DilemmaRoundStatus";

-- DropEnum
DROP TYPE "DilemmaChoice";

-- DropEnum
DROP TYPE "DilemmaCancelReason";

-- DropEnum
DROP TYPE "CorpseGameStatus";

-- DropEnum
DROP TYPE "CorpseParticipantState";

-- DropEnum
DROP TYPE "QuipsRoundPhase";

-- DropEnum
DROP TYPE "QuipsProvider";

-- DropEnum
DROP TYPE "QuipsSelectionSlot";
