import { describe, expect, test } from "bun:test";
import {
  buildDistillationPrompt,
  extractExcerpt,
  parseTimeToSeconds,
  renderMarkdownToHtml,
} from "../src/index.ts";

describe("@lectern/core markdown & distillation helpers", () => {
  test("parseTimeToSeconds parses MM:SS and HH:MM:SS accurately", () => {
    expect(parseTimeToSeconds("00:45")).toBe(45);
    expect(parseTimeToSeconds("12:30")).toBe(750);
    expect(parseTimeToSeconds("01:05:10")).toBe(3910);
  });

  test("renderMarkdownToHtml creates interactive timestamp chips, filter badges, and TOC", () => {
    const md = `# 📚 정보보호개론 강의 노트

## 📊 1. 녹음 타임라인 및 필터링 요약
- \`[쉬는 시간 생략: 48:10 ~ 59:00]\`
- \`[수업 종료 후 녹음 절단: 72:15 ~ 끝]\`

## 🎯 2. 교수님 강조 포인트
- [14:22] 대칭키 암호화(AES)와 비대칭키(RSA)의 연산 속도 비교는 중간고사 필수 출제.

### 대칭키 블록 암호 [21:05]
> [21:40] "블록 단위로 쪼개서 처리할 때 운영 모드(ECB, CBC, GCM)가 핵심입니다."
`;

    const rendered = renderMarkdownToHtml(md);

    expect(rendered.toc.length).toBe(3);
    expect(rendered.toc[0].text).toContain("녹음 타임라인");
    expect(rendered.toc[2].level).toBe(3);

    expect(rendered.html).toContain("filter-break");
    expect(rendered.html).toContain("filter-cut");
    expect(rendered.html).toContain(`data-sec="862"`); // 14:22 = 862s
    expect(rendered.html).toContain(`data-sec="1265"`); // 21:05 = 1265s
    expect(rendered.html).toContain(`<blockquote class="md-quote">`);
  });

  test("extractExcerpt skips headings and returns clean summary text", () => {
    const md = `# 제목\n\n---\n- **핵심 요약**: 공개키 기반 구조(PKI)와 인증서 체인의 동작 원리를 다룹니다.`;
    const ex = extractExcerpt(md);
    expect(ex).toContain("핵심 요약: 공개키 기반 구조(PKI)");
  });

  test("buildDistillationPrompt embeds course name, exact duration cap, and anti-hallucination rules", () => {
    const prompt = buildDistillationPrompt("자바프로그래밍", ["다형성", "인터페이스"], 185);
    expect(prompt).toContain("자바프로그래밍");
    expect(prompt).toContain("쉬는 시간 생략");
    expect(prompt).toContain("수업 종료 후 녹음 절단");
    expect(prompt).toContain("다형성, 인터페이스");
    expect(prompt).toContain("03:05");
    expect(prompt).toContain("절대 환각(Hallucination) 및 가상 창작 금지");
  });
});
