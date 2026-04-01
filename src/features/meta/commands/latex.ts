import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import sharp from 'sharp';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

import { buildFeedbackEmbed } from '../../polls/ui/poll-embeds.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({
  packages: AllPackages,
  inlineMath: [
    ['$', '$'],
    ['\\(', '\\)'],
  ],
  displayMath: [
    ['$$', '$$'],
    ['\\[', '\\]'],
  ],
});

const svg = new SVG({
  fontCache: 'none',
});

const html = mathjax.document('', {
  InputJax: tex,
  OutputJax: svg,
});

const background = {
  r: 60,
  g: 59,
  b: 67,
  alpha: 1,
} as const;

const foregroundHex = '#ffffff';

const normalizeLatexInput = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('Provide some LaTeX to render.');
  }

  if (trimmed.length > 1_500) {
    throw new Error('LaTeX input is too long. Keep it under 1,500 characters.');
  }

  return trimmed;
};

const exPx = 12;
const emPx = 24;

const convertSvgLengthToPixels = (value: string): string => {
  const match = /^([0-9]*\.?[0-9]+)(ex|em|px)?$/.exec(value.trim());

  if (!match) {
    return value;
  }

  const numeric = Number(match[1]);
  const unit = match[2] ?? 'px';

  switch (unit) {
    case 'ex':
      return `${numeric * exPx}px`;
    case 'em':
      return `${numeric * emPx}px`;
    default:
      return `${numeric}px`;
  }
};

const renderLatexSvg = (expression: string, displayMode: boolean): string => {
  const node = html.convert(expression, {
    display: displayMode,
    em: emPx,
    ex: exPx,
    containerWidth: 1_200,
  });

  const outer = adaptor.outerHTML(node);
  const svgMarkupMatch = outer.match(/<svg[\s\S]*<\/svg>/);

  if (!svgMarkupMatch) {
    throw new Error('Unable to generate SVG output for that LaTeX expression.');
  }

  return svgMarkupMatch[0]
    .replace(
      /<svg([^>]*?)style="([^"]*)"/,
      (_match, before: string, style: string) => `<svg${before}style="${style}; color: ${foregroundHex};"`,
    )
    .replace(
      /<svg((?:(?!style=)[^>])*)>/,
      (_match, before: string) => `<svg${before} style="color: ${foregroundHex};">`,
    )
    .replace(/width="([^"]+)"/, (_, value: string) => `width="${convertSvgLengthToPixels(value)}"`)
    .replace(/height="([^"]+)"/, (_, value: string) => `height="${convertSvgLengthToPixels(value)}"`);
};

export const renderLatexToPng = async (
  expression: string,
  displayMode: boolean,
): Promise<Buffer> => {
  const normalized = normalizeLatexInput(expression);
  const mathSvg = renderLatexSvg(normalized, displayMode);

  return sharp(Buffer.from(mathSvg), {
    density: 288,
  })
    .flatten({ background })
    .extend({
      top: 28,
      right: 36,
      bottom: 28,
      left: 36,
      background,
    })
    .png()
    .toBuffer();
};

export const latexCommand = new SlashCommandBuilder()
  .setName('latex')
  .setDescription('Render LaTeX into an image.')
  .addStringOption((option) =>
    option
      .setName('input')
      .setDescription('LaTeX expression to render')
      .setRequired(true)
      .setMaxLength(1500),
  )
  .addBooleanOption((option) =>
    option
      .setName('display_mode')
      .setDescription('Use display math layout')
      .setRequired(false),
  );

export const handleLatexCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const expression = interaction.options.getString('input', true);
  const displayMode = interaction.options.getBoolean('display_mode') ?? true;

  try {
    const buffer = await renderLatexToPng(expression, displayMode);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('LaTeX Render')
          .setDescription(`Source:\n\`\`\`tex\n${expression.trim()}\n\`\`\``)
          .setColor(0x60a5fa)
          .setImage('attachment://latex.png')
          .setFooter({
            text: displayMode ? 'Display mode' : 'Inline mode',
          }),
      ],
      files: [
        new AttachmentBuilder(buffer, {
          name: 'latex.png',
        }),
      ],
      allowedMentions: {
        parse: [],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to render that LaTeX expression.';

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildFeedbackEmbed('LaTeX Render Failed', message, 0xef4444)],
    });
  }
};
