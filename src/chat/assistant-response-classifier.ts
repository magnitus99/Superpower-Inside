import type { AssistantQuestion } from './types';

export type AssistantResponseClassification =
  | {
      type: 'answer';
      content: string;
      reasoning: string;
    }
  | {
      type: 'question';
      content: string;
      reasoning: string;
      question: AssistantQuestion;
    };

interface ClassifyInput {
  content: string;
  reasoning: string;
}

interface ParsedChoice {
  id: string;
  label: string;
}

const QUESTION_WORD_PATTERN =
  /(무엇|어떤|어느|어떻게|선택|골라|확인|알려\s*주|진행할까요|필요|범위|방식|항목|옵션|select|choose|which|what|confirm|option|apply)/i;
const MULTIPLE_SELECTION_PATTERN =
  /(여러|복수|해당되는|모두|전부|다중|2개 이상|여러 개|select all|all that apply|choose multiple|multiple)/i;
const FOLLOW_UP_SUGGESTION_PATTERN = /(원하면|원하시면|필요하면|괜찮다면|추가로).{0,30}(할까요|드릴까요|해드릴까요)\??$/;

export function classifyAssistantResponse(
  input: ClassifyInput,
): AssistantResponseClassification {
  const content = input.content.trim();
  const reasoning = input.reasoning.trim();

  const answerQuestion = detectQuestion(content, 'answer');
  if (answerQuestion) {
    return { type: 'question', content: '', reasoning, question: answerQuestion };
  }

  if (!content) {
    const leakedQuestion = detectQuestion(extractLastQuestionBlock(reasoning), 'reasoning-leak');
    if (leakedQuestion) {
      return { type: 'question', content: '', reasoning, question: leakedQuestion };
    }
  }

  return { type: 'answer', content, reasoning };
}

function detectQuestion(
  text: string,
  source: AssistantQuestion['source'],
): AssistantQuestion | null {
  const normalized = text.trim();
  if (!normalized) return null;
  if (source === 'answer' && isFollowUpSuggestion(normalized)) return null;

  const choices = extractChoices(normalized);
  const prompt = extractPrompt(normalized, choices);
  const hasQuestionSignal =
    /[?？]\s*$/.test(prompt) ||
    /(주세요|할까요|인가요|일까요|필요합니다|필요해요|확인해 주세요|선택해 주세요)/.test(prompt) ||
    QUESTION_WORD_PATTERN.test(prompt);

  if (choices.length === 0 && !hasQuestionSignal) return null;
  if (choices.length > 0 && !hasQuestionSignal && !QUESTION_WORD_PATTERN.test(normalized)) {
    return null;
  }

  return {
    prompt: prompt || normalized,
    choices,
    selectionMode:
      choices.length > 0 && MULTIPLE_SELECTION_PATTERN.test(normalized) ? 'multiple' : 'single',
    allowFreeText: true,
    source,
  };
}

function extractChoices(text: string): ParsedChoice[] {
  const choices: ParsedChoice[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const match = /^(?:[-*•]|\d+[.)]|[A-Za-z][.)])\s+(.+)$/.exec(trimmed);
    if (!match) continue;
    const label = match[1].trim();
    if (!label) continue;
    choices.push({ id: `choice-${choices.length + 1}`, label });
  }
  return choices;
}

function extractPrompt(text: string, choices: ParsedChoice[]): string {
  if (choices.length === 0) return text.trim();
  const promptLines: string[] = [];
  for (const line of text.split('\n')) {
    if (/^(?:[-*•]|\d+[.)]|[A-Za-z][.)])\s+/.test(line.trim())) break;
    promptLines.push(line);
  }
  return promptLines.join('\n').trim();
}

function extractLastQuestionBlock(reasoning: string): string {
  const lines = reasoning
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const questionLineIndex = [...lines]
    .reverse()
    .findIndex((line) => /[?？]\s*$/.test(line) || QUESTION_WORD_PATTERN.test(line));
  if (questionLineIndex < 0) return '';
  const startIndex = lines.length - 1 - questionLineIndex;
  const firstLine = lines[startIndex];
  const sentenceMatch = /([^.!?。！？]*[?？])\s*$/.exec(firstLine);
  return [sentenceMatch?.[1]?.trim() ?? firstLine, ...lines.slice(startIndex + 1)].join('\n');
}

function isFollowUpSuggestion(text: string): boolean {
  return text.length > 30 && FOLLOW_UP_SUGGESTION_PATTERN.test(text);
}
