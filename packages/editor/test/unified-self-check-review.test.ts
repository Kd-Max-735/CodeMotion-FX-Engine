import { describe, expect, it } from "vitest";
import {
  SelfCheckReviewValidationError,
  VolcengineArkUnifiedSelfCheckReviewer,
  parseUnifiedSelfCheckResult
} from "../src/unified-self-check-review.js";

const RULE_IDS = Object.freeze(["EFFECT_MATCH", "FRAME_QUALITY"]);

function result(status: "pass" | "fail" | "inconclusive") {
  const checks = RULE_IDS.map((ruleId, index) => ({
    ruleId,
    status: index === 0 ? status : "pass",
    evidenceRefs: ["keyframe_contact_sheet"],
    reason: status === "fail" && index === 0 ? "成片效果与用户明确要求不一致。" : "关键帧证据支持当前判断。"
  }));
  return {
    status,
    summary: status === "pass" ? "成片符合用户要求。" : status === "fail"
      ? "成片存在一项明确不匹配。" : "当前证据不足，无法可靠判断。",
    checks,
    issues: status === "fail" ? [{
      ruleId: RULE_IDS[0],
      code: "EFFECT_MISMATCH",
      message: "实际成片表现与用户明确要求不一致。",
      evidenceRefs: ["self_check_view", "keyframe_contact_sheet"]
    }] : []
  };
}

describe("unified self-check review contract", () => {
  it.each(["pass", "fail", "inconclusive"] as const)("accepts a consistent %s result", (status) => {
    expect(parseUnifiedSelfCheckResult(result(status), RULE_IDS).status).toBe(status);
  });

  it("rejects a fail result without a user-facing issue", () => {
    expect(() => parseUnifiedSelfCheckResult({ ...result("fail"), issues: [] }, RULE_IDS))
      .toThrow(SelfCheckReviewValidationError);
  });

  it("rejects unavailable evidence references", () => {
    const value = result("pass");
    value.checks[0]!.evidenceRefs = ["local_file_path"];
    expect(() => parseUnifiedSelfCheckResult(value, RULE_IDS)).toThrow(/不存在的证据/u);
  });

  it("retries one invalid model response and returns the corrected decision", async () => {
    const bodies = [
      { choices: [{ message: { content: JSON.stringify({ status: "fail", summary: "缺少其余字段" }) } }] },
      { choices: [{ message: { content: JSON.stringify(result("fail")) } }] }
    ];
    const requests: string[] = [];
    const reviewer = new VolcengineArkUnifiedSelfCheckReviewer({
      apiKey: "test-api-key-value",
      fetchImpl: async (_input, init) => {
        requests.push(String(init?.body));
        return new Response(JSON.stringify(bodies.shift()), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });
    const reviewed = await reviewer.review({
      requestId: "request-1",
      tenantId: "tenant-1",
      userId: "user-1",
      toolName: "bounce",
      displayName: "重力弹跳",
      ruleIds: RULE_IDS,
      rule: "根据最终关键帧判断弹跳是否符合用户要求。",
      acceptanceView: Object.freeze({ original_request: "弹跳三次" }),
      evidencePng: Buffer.from("evidence")
    });
    expect(reviewed.status).toBe("fail");
    expect(reviewed.issues[0]?.message).toContain("不一致");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain("上一次返回未通过协议校验");
  });

  it("reports the exact validation reason after two invalid model responses", async () => {
    const reviewer = new VolcengineArkUnifiedSelfCheckReviewer({
      apiKey: "test-api-key-value",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ status: "pass", summary: "缺少 checks 和 issues" }) } }]
      }), { status: 200, headers: { "content-type": "application/json" } })
    });
    await expect(reviewer.review({
      requestId: "request-invalid",
      tenantId: "tenant-1",
      userId: "user-1",
      toolName: "bounce",
      displayName: "重力弹跳",
      ruleIds: RULE_IDS,
      rule: "根据最终关键帧判断弹跳是否符合用户要求。",
      acceptanceView: Object.freeze({ original_request: "弹跳三次" }),
      evidencePng: Buffer.from("evidence")
    })).rejects.toThrow(/连续两次.*字段必须严格为.*checks.*issues/u);
  });
});
