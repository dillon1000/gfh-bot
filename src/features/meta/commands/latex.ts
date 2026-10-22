import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import sharp from 'sharp';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
// Lets MathJax load font ranges on demand.
import '@mathjax/src/js/util/asyncLoad/esm.js';
// Each import registers its TeX package; texPackages lists them by name.
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/action/ActionConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js';
import '@mathjax/src/js/input/tex/bbox/BboxConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/braket/BraketConfiguration.js';
import '@mathjax/src/js/input/tex/bussproofs/BussproofsConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/cases/CasesConfiguration.js';
import '@mathjax/src/js/input/tex/centernot/CenternotConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/colortbl/ColortblConfiguration.js';
import '@mathjax/src/js/input/tex/empheq/EmpheqConfiguration.js';
import '@mathjax/src/js/input/tex/enclose/EncloseConfiguration.js';
import '@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js';
import '@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js';
import '@mathjax/src/js/input/tex/html/HtmlConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/noerrors/NoErrorsConfiguration.js';
import '@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import '@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js';
import '@mathjax/src/js/input/tex/unicode/UnicodeConfiguration.js';
import '@mathjax/src/js/input/tex/verb/VerbConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/tagformat/TagFormatConfiguration.js';
import '@mathjax/src/js/input/tex/textcomp/TextcompConfiguration.js';
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js';
import { MathJaxMhchemFontExtension } from '@mathjax/mathjax-mhchem-font-extension/js/svg.js';

import { buildFeedbackEmbed } from '@/lib/feedback-embeds.js';

const texPackages = [
  'base',
  'action',
  'ams',
  'amscd',
  'bbox',
  'boldsymbol',
  'braket',
  'bussproofs',
  'cancel',
  'cases',
  'centernot',
  'color',
  'colortbl',
  'empheq',
  'enclose',
  'extpfeil',
  'gensymb',
  'html',
  'mathtools',
  'mhchem',
  'newcommand',
  'noerrors',
  'noundefined',
  'upgreek',
  'unicode',
  'verb',
  'configmacros',
  'tagformat',
  'textcomp',
  'textmacros',
  'physics',
];

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({
  packages: texPackages,
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
  // Keep inline math in one SVG instead of splitting it at break points.
  linebreaks: { inline: false },
});
svg.addExtension(MathJaxMhchemFontExtension);

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

const renderLatexSvg = async (expression: string, displayMode: boolean): Promise<string> => {
  const node = await html.convertPromise(expression, {
    display: displayMode,
    em: emPx,
    ex: exPx,
    containerWidth: 1_200,
  });

  // XML serialization escapes characters like < inside attributes, which sharp requires.
  const outer = adaptor.serializeXML(node);
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
  const mathSvg = await renderLatexSvg(normalized, displayMode);

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
