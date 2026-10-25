import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AppError } from '../../application/errors.js';
import type { RecoveryService } from '../../application/recovery-service.js';
import { caseModeSchema } from '../../domain/case.js';
import type { CaseView } from '../../domain/case-view.js';
import { intentAnchorInputSchema } from '../../domain/intent.js';
import { disruptionSchema } from '../../domain/plan.js';
import { scenarios } from '../../simulation/scenarios.js';
import { summariseCase } from './summary.js';

export interface McpServerOptions {
  service: RecoveryService;
  /** Hashed session key that owns every case opened through this server. */
  sessionKey: string;
  version: string;
}

/**
 * Operating rules for the model that drives the tools. They mirror the product rules: unknown is
 * never treated as a pass, the person's own word is the only way to settle a fact, and nothing is
 * ever booked.
 */
export const MCP_INSTRUCTIONS = [
  'AFTERGLOW recovers a plan when a venue falls through. It keeps what the group wanted, uses taste data to find alternatives, rejects any place that fails a hard constraint, and replans.',
  'Rules for the caller:',
  'Never state a venue fact the tools did not return. A fact marked unknown stays unknown until the person tells you the answer.',
  'Call afterglow_attest_fact only with an answer the person gave in this conversation. Do not infer it, and do not answer a verification question yourself.',
  'Call afterglow_relax_constraints only after the person has agreed to that exact change.',
  'AFTERGLOW never books, calls or pays. Call afterglow_confirm_attempt only when the person says they secured the place.',
  'Always tell the person where results came from. Results from demo mode come from an invented catalogue and are not Qloo data.',
  'Send public cultural names only (artists, films, places). Never put personal details about the group into any field.',
  'Taste results describe what groups with similar taste tend to like. They say nothing about any individual.',
].join('\n');

function textResult(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function failure(error: unknown): CallToolResult {
  if (error instanceof AppError) {
    return textResult({ error: { code: error.code, message: error.message } }, true);
  }
  // Details go to stderr only. Stdout carries the protocol and nothing else.
  console.error('AFTERGLOW tool failed:', error instanceof Error ? error.name : 'unknown error');
  return textResult(
    { error: { code: 'internal_error', message: 'The tool could not complete the request.' } },
    true,
  );
}

async function respond(work: () => Promise<CaseView> | CaseView): Promise<CallToolResult> {
  try {
    return textResult(summariseCase(await work()));
  } catch (error) {
    return failure(error);
  }
}

const caseId = z.string().min(1).max(100).describe('The id returned when the case was opened.');
const candidateId = z.string().min(1).max(200).describe('The id of an option in the case.');

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const writesLocal = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const writesAndSearches = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

export function createMcpServer(options: McpServerOptions): McpServer {
  const { service, sessionKey } = options;
  const server = new McpServer(
    { name: 'afterglow', version: options.version },
    { instructions: MCP_INSTRUCTIONS },
  );

  server.registerTool(
    'afterglow_demo_scenarios',
    {
      title: 'List demo scenarios',
      description:
        'Lists ready made scenarios for the labelled demo mode, each with an anchor and a disruption that can be passed to afterglow_open_case. The demo catalogue is invented and is not Qloo data.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () =>
      textResult({
        scenarios: scenarios
          .filter((scenario) => scenario.featured)
          .map(({ id, title, summary, anchor, disruption, choices }) => ({
            id,
            title,
            summary,
            anchor,
            disruption,
            ...(choices ? { choices } : {}),
          })),
      }),
  );

  server.registerTool(
    'afterglow_open_case',
    {
      title: 'Open a recovery case',
      description:
        'Records what the plan was for (the intent anchor), records what went wrong, resolves the named taste signals and runs the first search. Use mode demo unless the person asked for live Qloo results and the server has a key.',
      inputSchema: {
        mode: caseModeSchema.describe('demo uses an invented labelled catalogue. live uses Qloo.'),
        anchor: intentAnchorInputSchema,
        disruption: disruptionSchema,
      },
      annotations: writesAndSearches,
    },
    ({ mode, anchor, disruption }) =>
      respond(() => service.openCase(sessionKey, { mode, anchor, disruption })),
  );

  server.registerTool(
    'afterglow_list_cases',
    {
      title: 'List cases',
      description: 'Lists the cases opened through this server, newest first.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      try {
        return textResult({
          cases: service.listCases(sessionKey).map((item) => ({
            caseId: item.id,
            title: item.title,
            mode: item.mode,
            status: item.status,
            updatedAt: item.updatedAt,
          })),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'afterglow_get_case',
    {
      title: 'Get a case',
      description:
        'Returns the current state of a case: the shortlist, what was removed and why, open questions for the person, and the next suggested actions.',
      inputSchema: { caseId },
      annotations: readOnly,
    },
    ({ caseId: id }) => respond(() => service.getCase(sessionKey, id)),
  );

  server.registerTool(
    'afterglow_get_provenance',
    {
      title: 'Get provenance',
      description:
        'Returns the redacted record of every request sent to the taste provider for a case and what came back, so the person can see exactly what left the server.',
      inputSchema: { caseId },
      annotations: readOnly,
    },
    async ({ caseId: id }) => {
      try {
        return textResult(service.getProvenance(sessionKey, id));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'afterglow_choose_signal',
    {
      title: 'Settle an ambiguous taste signal',
      description:
        'When a named signal matched several entries, records which one the person meant, or skips it. Ask the person first.',
      inputSchema: {
        caseId,
        key: z.string().min(1).max(300).describe('The key of a pending choice.'),
        chosenId: z.string().min(1).max(300).optional().describe('The id of the entry chosen.'),
        skip: z.boolean().optional().describe('True to drop this signal.'),
      },
      annotations: writesAndSearches,
    },
    ({ caseId: id, key, chosenId, skip }) =>
      respond(() =>
        service.chooseResolution(sessionKey, id, {
          key,
          ...(chosenId !== undefined ? { chosenId } : {}),
          ...(skip !== undefined ? { skip } : {}),
        }),
      ),
  );

  server.registerTool(
    'afterglow_record_disruption',
    {
      title: 'Record a disruption',
      description:
        'Records a new thing that went wrong, such as rain, a late arrival, a smaller budget or a different party size, and searches again under the changed plan.',
      inputSchema: { caseId, disruption: disruptionSchema },
      annotations: writesAndSearches,
    },
    ({ caseId: id, disruption }) =>
      respond(() => service.recordDisruption(sessionKey, id, disruption)),
  );

  server.registerTool(
    'afterglow_search_again',
    {
      title: 'Search again',
      description:
        'Runs the search again with the current plan, for example after a failed search.',
      inputSchema: { caseId },
      annotations: writesAndSearches,
    },
    ({ caseId: id }) => respond(() => service.rerunSearch(sessionKey, id)),
  );

  server.registerTool(
    'afterglow_attest_fact',
    {
      title: 'Record what the person checked',
      description:
        'Records that the person checked one hard constraint for one option and found it satisfied or not. Call this only with an answer the person gave you. It is never inferred, and it overrides any data the app held.',
      inputSchema: {
        caseId,
        candidateId,
        constraintKey: z
          .string()
          .min(1)
          .max(80)
          .describe('The key from questionsForThePerson, for example open_at_plan_time.'),
        satisfied: z.boolean().describe('What the person reported.'),
      },
      annotations: writesLocal,
    },
    (input) =>
      respond(() =>
        service.attestFact(sessionKey, input.caseId, {
          candidateId: input.candidateId,
          constraintKey: input.constraintKey,
          satisfied: input.satisfied,
        }),
      ),
  );

  server.registerTool(
    'afterglow_relax_constraints',
    {
      title: 'Give up a constraint',
      description:
        'Gives up the named hard constraints. It works only when no option is left and that exact change was offered in relaxationsOffered. Call it only after the person agreed.',
      inputSchema: {
        caseId,
        constraintKeys: z.array(z.string().min(1).max(80)).min(1).max(10),
      },
      annotations: writesAndSearches,
    },
    ({ caseId: id, constraintKeys }) =>
      respond(() => service.relaxConstraints(sessionKey, id, constraintKeys)),
  );

  server.registerTool(
    'afterglow_reject_option',
    {
      title: 'Rule out an option',
      description: 'Removes an option the person does not want, with an optional short reason.',
      inputSchema: { caseId, candidateId, reason: z.string().trim().max(200).optional() },
      annotations: writesLocal,
    },
    ({ caseId: id, candidateId: option, reason }) =>
      respond(() => service.rejectOption(sessionKey, id, option, reason)),
  );

  server.registerTool(
    'afterglow_start_attempt',
    {
      title: 'Start an attempt',
      description:
        'Marks that the person is going to try an option. AFTERGLOW does not contact the venue or book anything.',
      inputSchema: { caseId, candidateId },
      annotations: writesLocal,
    },
    ({ caseId: id, candidateId: option }) =>
      respond(() => service.startAttempt(sessionKey, id, option)),
  );

  server.registerTool(
    'afterglow_confirm_attempt',
    {
      title: 'Record a secured option',
      description:
        'Records that the person says they secured the place. Call this only when they told you so. Nothing was booked by AFTERGLOW.',
      inputSchema: { caseId, candidateId },
      annotations: writesLocal,
    },
    ({ caseId: id, candidateId: option }) =>
      respond(() => service.confirmAttempt(sessionKey, id, option)),
  );

  server.registerTool(
    'afterglow_fail_attempt',
    {
      title: 'Record a failed attempt',
      description:
        'Records that the option did not work out. It is removed and the shortlist updates.',
      inputSchema: { caseId, candidateId, note: z.string().trim().max(200).optional() },
      annotations: writesLocal,
    },
    ({ caseId: id, candidateId: option, note }) =>
      respond(() => service.failAttempt(sessionKey, id, option, note)),
  );

  server.registerTool(
    'afterglow_close_case',
    {
      title: 'Close a case',
      description:
        'Closes the case as recovered, which needs a confirmed option, or as abandoned if the person gives up.',
      inputSchema: { caseId, outcome: z.enum(['recovered', 'abandoned']) },
      annotations: writesLocal,
    },
    ({ caseId: id, outcome }) => respond(() => service.closeCase(sessionKey, id, outcome)),
  );

  return server;
}
