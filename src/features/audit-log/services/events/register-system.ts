import {
	type AutoModerationActionExecution,
	type AutoModerationRule,
	Events,
	type Client,
	type GuildAuditLogsEntry,
	type GuildChannel,
	type Guild,
	type Interaction,
} from "discord.js";

import { registerAuditHandler } from "./register-shared.js";
import { isRecord, normalizeJson } from "./normalize.js";
import { recordAuditLogEvent } from "./delivery.js";
import {
	summarizeAuditLogEntry,
	summarizeChannel,
	summarizeGuild,
	summarizeInteraction,
} from "./summarize.js";

export const registerSystemAuditLogEventHandlers = (client: Client): void => {
	registerAuditHandler<[GuildAuditLogsEntry, { id: string }]>(
		client,
		Events.GuildAuditLogEntryCreate,
		async (entry, guild) => {
			await recordAuditLogEvent(client, {
				guildId: guild.id,
				bucket: "primary",
				source: "audit",
				eventName: "audit.entry_create",
				payload: {
					entry: summarizeAuditLogEntry(entry),
				},
			});
		},
	);

	registerAuditHandler<[Interaction]>(
		client,
		Events.InteractionCreate,
		async (interaction) => {
			if (!interaction.guildId) {
				return;
			}

			await recordAuditLogEvent(client, {
				guildId: interaction.guildId,
				bucket: "noisy",
				source: "bot",
				eventName: "interaction.create",
				payload: summarizeInteraction(interaction),
			});
		},
	);

	registerAuditHandler<[AutoModerationActionExecution]>(
		client,
		Events.AutoModerationActionExecution,
		async (execution) => {
			const guildId =
				isRecord(execution) &&
				"guild" in execution &&
				isRecord(execution.guild) &&
				typeof execution.guild.id === "string"
					? execution.guild.id
					: null;
			if (!guildId) {
				return;
			}

			await recordAuditLogEvent(client, {
				guildId,
				bucket: "primary",
				source: "gateway",
				eventName: "automod.execution",
				payload: normalizeJson(execution),
			});
		},
	);

	registerAuditHandler<[GuildChannel]>(
		client,
		Events.WebhooksUpdate,
		async (channel) => {
			await recordAuditLogEvent(client, {
				guildId: channel.guildId,
				bucket: "primary",
				source: "gateway",
				eventName: "webhooks.update",
				payload: {
					channel: summarizeChannel(channel),
				},
			});
		},
	);

	registerAuditHandler<[Guild]>(
		client,
		Events.GuildIntegrationsUpdate,
		async (guild) => {
			const guildId =
				isRecord(guild) && typeof guild.id === "string" ? guild.id : null;
			if (!guildId) {
				return;
			}

			await recordAuditLogEvent(client, {
				guildId,
				bucket: "primary",
				source: "gateway",
				eventName: "guild.integrations_update",
				payload: {
					guild: summarizeGuild(guild),
				},
			});
		},
	);

	registerAuditHandler<[AutoModerationRule]>(
		client,
		Events.AutoModerationRuleCreate,
		async (rule) => {
			const guildId =
				isRecord(rule) &&
				"guild" in rule &&
				isRecord(rule.guild) &&
				typeof rule.guild.id === "string"
					? rule.guild.id
					: null;
			if (!guildId) {
				return;
			}

			await recordAuditLogEvent(client, {
				guildId,
				bucket: "primary",
				source: "gateway",
				eventName: "automod.rule_create",
				payload: normalizeJson(rule),
			});
		},
	);

	registerAuditHandler<[AutoModerationRule]>(
		client,
		Events.AutoModerationRuleDelete,
		async (rule) => {
			const guildId =
				isRecord(rule) &&
				"guild" in rule &&
				isRecord(rule.guild) &&
				typeof rule.guild.id === "string"
					? rule.guild.id
					: null;
			if (!guildId) {
				return;
			}

			await recordAuditLogEvent(client, {
				guildId,
				bucket: "primary",
				source: "gateway",
				eventName: "automod.rule_delete",
				payload: normalizeJson(rule),
			});
		},
	);

	registerAuditHandler<[AutoModerationRule | null, AutoModerationRule]>(
		client,
		Events.AutoModerationRuleUpdate,
		async (oldRule, newRule) => {
			const guildId =
				isRecord(newRule) &&
				"guild" in newRule &&
				isRecord(newRule.guild) &&
				typeof newRule.guild.id === "string"
					? newRule.guild.id
					: null;
			if (!guildId) {
				return;
			}

			await recordAuditLogEvent(client, {
				guildId,
				bucket: "primary",
				source: "gateway",
				eventName: "automod.rule_update",
				payload: {
					before: normalizeJson(oldRule),
					after: normalizeJson(newRule),
				},
			});
		},
	);

	registerAuditHandler<[Guild, Guild]>(
		client,
		Events.GuildUpdate,
		async (oldGuild, newGuild) => {
			const guildId =
				isRecord(newGuild) && typeof newGuild.id === "string"
					? newGuild.id
					: null;
			if (!guildId) {
				return;
			}

			await recordAuditLogEvent(client, {
				guildId,
				bucket: "primary",
				source: "gateway",
				eventName: "guild.update",
				payload: {
					before: summarizeGuild(oldGuild),
					after: summarizeGuild(newGuild),
				},
			});
		},
	);
};
