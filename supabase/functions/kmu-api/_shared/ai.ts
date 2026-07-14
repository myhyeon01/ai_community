function outputText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  return output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .map((item: any) => item?.text || "").filter(Boolean).join("\n");
}

async function openAI(instructions: string, input: unknown): Promise<any> {
  const key = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPEN_AI_KEY");
  if (!key) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
      instructions: `${instructions}\nReturn only valid json.`,
      input: `Return only valid json.\n${JSON.stringify(input)}`,
      text: { format: { type: "json_object" } },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI 요청에 실패했습니다.");
  const text = outputText(data);
  return JSON.parse(text || "{}");
}

export async function refineSchedule(context: Record<string, unknown>) {
  try {
    const result = await openAI(
      "당신은 대학생 일정 코치입니다. fixed_blocks는 변경할 수 없는 기존 일정이며 응답 items에 절대 다시 포함하지 마세요. draft_plan을 참고해 새로 추천하거나 조정한 task, study, rest 일정만 반환하세요. 수업, 개인일정, 통학시간과 절대 겹치지 않게 하고 모든 일정 사이 최소 15분 전환시간을 확보하세요. 같은 제목의 일정을 두 번 만들지 말고, 12~14시 사이 식사시간은 최대 1개만 배치하세요. 반드시 {summary:string,items:[{title,start,end,type,subtitle}]} JSON만 반환하세요. start와 end는 HH:MM 형식이고 type은 task, study, rest 중 하나입니다.",
      context,
    );
    return { available: true, source: "openai", message: String(result.summary || "AI가 이동·휴식·마감 조건을 반영했습니다."), items: Array.isArray(result.items) ? result.items : [] };
  } catch (error) {
    return { available: false, source: "fallback", items: [], message: `규칙 기반 추천을 유지했습니다. ${error instanceof Error ? error.message : ""}`.trim() };
  }
}

export async function chatSchedule(message: string, context: Record<string, unknown>, history: unknown[]) {
  try {
    const result = await openAI(
      "KMU Smart Scheduler 사용법과 대학생활 일정을 돕는 한국어 챗봇입니다. 제공된 app_guide 안에서 사용법을 답하고 일정 변경 요청이면 충돌, 통학, 식사, 15분 전환시간을 검토하세요. 반드시 {reply:string,items:array,preference_updates:object,navigate_to:string} JSON만 반환하세요.",
      { message, context, history: history.slice(-12) },
    );
    return { available: true, reply: String(result.reply || "요청을 확인했습니다."), items: Array.isArray(result.items) ? result.items : [], preference_updates: result.preference_updates && typeof result.preference_updates === "object" ? result.preference_updates : {}, navigate_to: String(result.navigate_to || "") };
  } catch (error) {
    return { available: false, reply: `현재 AI 연결을 사용할 수 없습니다. 시간표·개인일정·공부계획을 확인해 주세요. (${error instanceof Error ? error.message : "설정 오류"})`, items: [], preference_updates: {}, navigate_to: "" };
  }
}

export async function summarizeNotice(notice: Record<string, unknown>) {
  try {
    return { available: true, ...(await openAI("대학 공지를 한국어로 간결히 요약하세요. 반드시 {summary:string,keyPoints:string[],deadline:string|null} JSON만 반환하세요.", notice)) };
  } catch (error) {
    return { available: false, message: error instanceof Error ? error.message : "AI 요약을 사용할 수 없습니다." };
  }
}
