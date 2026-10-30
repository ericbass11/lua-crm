import type { StepResult, ToolSet } from "ai";

/** Metadata only. Never retain model text, tool arguments, outputs or error messages. */
export interface ModelStepDiagnostic {
  step: number;
  finish_reason: StepResult<ToolSet>["finishReason"];
  tools: Array<{
    tool_name: string;
    status: "invalid" | "error" | "rejected" | "completed" | "no_result";
    error_code:
      "unknown_tool" | "invalid_tool_input" | "tool_execution_error" | "tool_rejected" | null;
  }>;
}

export function stepLimitWithoutResponse(
  diagnostics: { steps: ModelStepDiagnostic[]; step_limit_reached: boolean },
  hasResponse: boolean,
): boolean {
  const handedOff = diagnostics.steps.some((step) =>
    step.tools.some(
      (tool) => tool.tool_name === "request_human_handoff" && tool.status === "completed",
    ),
  );
  return diagnostics.step_limit_reached && !hasResponse && !handedOff;
}

export function diagnoseModelStep(
  step: StepResult<ToolSet>,
  declaredTools: ToolSet | undefined,
): ModelStepDiagnostic {
  return {
    step: step.stepNumber + 1,
    finish_reason: step.finishReason,
    tools: step.toolCalls.map((call) => {
      const known = Object.hasOwn(declaredTools ?? {}, call.toolName);
      const failed = step.content.some(
        (part) => part.type === "tool-error" && part.toolCallId === call.toolCallId,
      );
      const result = step.toolResults.find((part) => part.toolCallId === call.toolCallId);
      const rejected =
        result?.output !== null &&
        typeof result?.output === "object" &&
        "ok" in result.output &&
        result.output.ok === false;
      return {
        // Unknown model-supplied names can contain arbitrary private data.
        tool_name: known ? call.toolName : "unknown_tool",
        status: call.invalid
          ? "invalid"
          : failed
            ? "error"
            : rejected
              ? "rejected"
              : result
                ? "completed"
                : "no_result",
        error_code: !known
          ? "unknown_tool"
          : call.invalid
            ? "invalid_tool_input"
            : failed
              ? "tool_execution_error"
              : rejected
                ? "tool_rejected"
                : null,
      };
    }),
  };
}
