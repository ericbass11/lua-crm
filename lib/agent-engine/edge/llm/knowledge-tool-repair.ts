import type { ToolCallRepairFunction, ToolSet } from 'ai';
import { z } from 'zod';

type RepairOptions = Parameters<ToolCallRepairFunction<ToolSet>>[0];
type InputDiagnostic = {
  code: 'knowledge_tool_input_invalid' | 'knowledge_tool_input_repaired';
  fields: string[];
  issue_codes: string[];
};
const KNOWN_FIELDS = new Set(['pergunta', 'quantidade', 'assistente_id', 'query', 'topK']);
const ISSUE_CODES = new Set(['invalid_type', 'invalid_value', 'invalid_format', 'too_small', 'too_big', 'custom']);

/** Only spelling/optional-null recovery for this declared read. The SDK validates
 * the repaired call again; identities, authority and execution remain unchanged. */
export async function repairKnowledgeToolCall(
  options: RepairOptions,
  diagnostic?: (value: InputDiagnostic) => void,
): ReturnType<ToolCallRepairFunction<ToolSet>> {
  if (options.toolCall.toolName !== 'crm_search_knowledge') return null;
  const schema = options.tools.crm_search_knowledge?.inputSchema;
  if (!(schema instanceof z.ZodType)) return null;
  let raw: unknown;
  try { raw = JSON.parse(options.toolCall.input); }
  catch {
    diagnostic?.({ code: 'knowledge_tool_input_invalid', fields: ['payload'], issue_codes: ['invalid_json'] });
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some(key => !KNOWN_FIELDS.has(key))) {
    diagnostic?.({ code: 'knowledge_tool_input_invalid', fields: ['payload'], issue_codes: ['unknown_field'] });
    return null;
  }
  if (('query' in input && 'pergunta' in input) || ('topK' in input && 'quantidade' in input)) {
    diagnostic?.({ code: 'knowledge_tool_input_invalid', fields: ['payload'], issue_codes: ['ambiguous_alias'] });
    return null;
  }
  const candidate = { ...input };
  const changed: string[] = [];
  for (const [alias, canonical] of [['query', 'pergunta'], ['topK', 'quantidade']] as const) {
    if (Object.hasOwn(candidate, alias)) {
      candidate[canonical] = candidate[alias];
      delete candidate[alias];
      changed.push(alias);
    }
  }
  for (const optional of ['quantidade', 'assistente_id'] as const) {
    if (candidate[optional] === null) {
      delete candidate[optional];
      changed.push(optional);
    }
  }
  const validated = await schema.safeParseAsync(candidate);
  if (!validated.success) {
    diagnostic?.({
      code: 'knowledge_tool_input_invalid',
      fields: [...new Set(validated.error.issues.map(issue => {
        const field = issue.path[0];
        return typeof field === 'string' && KNOWN_FIELDS.has(field) ? field : 'payload';
      }))],
      issue_codes: [...new Set(validated.error.issues.map(issue => ISSUE_CODES.has(issue.code) ? issue.code : 'validation_failed'))],
    });
    return null;
  }
  if (changed.length === 0) return null;
  diagnostic?.({ code: 'knowledge_tool_input_repaired', fields: changed, issue_codes: [] });
  return { ...options.toolCall, input: JSON.stringify(validated.data) };
}
