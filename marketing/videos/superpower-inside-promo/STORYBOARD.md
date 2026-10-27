---
format: 1920x1080
duration: 64s
message: From your material to your next step
arc: Value to next step
audience: Obsidian users who research, compare and write from their material
mode: autonomous
music: none
---

이 문서는 2026-10-14 작품의 장면·과거안·개정 이력이다. 지속 계약은 [마케팅 스펙](../../SPEC.md)이 소유한다. 컴포지션·캡처·렌더는 로컬 산출물이며 이 문서의 과거 합성 장면은 현재 기능·응답 속도·모델 실행의 보증이 아니다.

## 현재 제작 기준

최신 기준: 2026-10-14. 지속 지침은 [마케팅 AGENTS.md](../../AGENTS.md), 조사와 최신 비트 시트는 [video-plan.md](../../video-plan.md)를 따른다. 정확한 화면·타이밍은 현재 `index.html`과 아래 9개 컴포지션이다. 글쓰기 장면에 실제 제품 화면을 반영했고 한영 최종 MP4 출력을 완료했다.

| 장면 | 구간 | 컴포지션 |
| --- | --- | --- |
| 다음 생각 | 0–6초 | `compositions/frames/01-next-thought.html` |
| 필요한 결과 | 6–12초 | `compositions/frames/02-your-intent.html` |
| 프로젝트 복귀 | 12–20초 | `compositions/frames/03-pick-up.html` |
| 함께 보는 비교 | 20–28초 | `compositions/frames/04-see-together.html` |
| 판단의 근거 | 28–35초 | `compositions/frames/05-grounded.html` |
| 내 자료로 글쓰기 · 실제 UI | 35–45초 | `compositions/frames/06-your-draft.html` |
| 제품 방향성 | 45–52초 | `compositions/frames/07-our-direction.html` |
| AI 선택 | 52–57초 | `compositions/frames/08-your-choice.html` |
| 설치 행동 | 57–64초 | `compositions/frames/09-next-step.html` |

아래 41초안의 장면·문구·스타일과 날짜별 기록은 과거 이력이다. 현재 제작 기준으로 적용하지 않는다. 실제 UI를 추가할 때는 설득 구조에 맞게 최신 표와 컴포지션을 함께 갱신한다.

## 과거 Video direction · 현재 기준에서 제외

- palette system — from frame.md: dark editor canvas (#1a1a22) carries every frame; light ink (#e8e6ef) for body and display; single purple accent (#7c3aed) rationed to ONE element per frame (the highlight, the active chip, the button, or the wordmark accent); warm-navy code surface + JetBrains Mono for paths, line numbers, file chips; hairline rules and 4% tint panels as the only containers — no shadows, no gradients.
- motion grammar — long-tail power eases, smooth over bouncy, 200–300ms per move; reveals land on their text cue (no voiceover: the on-screen copy IS the cue track — each reveal fires when its line is being read); holds are still — at most a caret blink or a one-element live readout; no camera drift on holds.
- rhythm — Frames 4 (Honest) and 7 (Install) are the calm held beats; Frame 3 (Proof) is the climax with the most travel; everything else reveals to cue then settles.
- negative list — no neon glow, no particles, no 3D logo spin, no count-up numbers, no sub-second montage, no slideshow (front-load then freeze), no screensaver float; never animate a .clip element; no browser chrome or nav bars; the recreated product UI stays faithful to the Obsidian side-panel register (narrow column, flat surfaces).
- caption band — captions disabled, but keep all key content in the top 83 percent; nothing important sits in the bottom edge.

## Frame 1 — Scattered

- scene: File cards for PDF, EPUB, DOCX, HWPX and MD scatter inward and crowd the frame around a small question line
- duration: 5s
- transition_in: cut
- status: animated
- src: compositions/frames/01-scattered.html
- type: hook
- persuasion: Pain agitation
- beat: overwhelm → curiosity
- blueprint: overwhelm-surround (clutter-shove-to-question variant)
- asset_candidates:
- poster: 3s

narrativeRole: Open on the felt pain. Months of mixed-format documents accumulate until the vault feels crowded, then one quiet question cuts through: Where did we decide that?
keyMessage: Your knowledge is all there, but unreachable in the moment you need it.

Scene 1 (0.0–2.0s): centered composition. Document cards (labeled PDF, EPUB, DOCX, HWPX, MD with file icons) pop and slide up in a springy stagger, overlapping into a loose cloud; inner text lines scroll as live density. Slow steady zoom-out runs underneath the accumulation.
Scene 2 (2.0–3.5s): the signature move — camera reverses into a quick push-in that shoves the clutter to the frame edges, opening central negative space.
Scene 3 (3.5–5.0s): two-part serif question builds word-by-word in the cleared center (line 1 swaps in place to line 2): Where did we decide / that? A mono cursor glides in and rests under the text. Hold with very slow forward creep.

## Frame 2 — Ask

- scene: The Obsidian side panel: the question types itself into the composer, submits, and the answer streams in citing the sprint note and the PDF page
- duration: 9s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-ask.html
- type: product_intro
- persuasion: Show-don-tell proof
- beat: curiosity → clarity
- blueprint: prompt-type-submit-generate
- asset_candidates:
- poster: 6s

narrativeRole: The calm product intro. The scattered world condenses into one chat panel; the synthetic Ferryline question types, submits, and the answer arrives already carrying two source citations.
keyMessage: Ask in your own link syntax; the answer comes back with its sources attached.

Scene 1 (0.0–1.5s): asymmetric 40/60 — narrow Obsidian side panel right-of-center on the dark canvas, composer empty, send button idle. Panel rises 4px and settles.
Scene 2 (1.5–5.0s): the question types character-by-character into the composer with a live caret: Compare the pilot scope decision in [[2026-05-12-sprint-notes.md]] with the recommendation in [[Vendor-Proposal-Tidefield.pdf]]. Where do they conflict? Cite the sources.
Scene 3 (5.0–6.0s): submit — send button fills with the single purple accent, composer clears, a quiet working pulse runs under the panel.
Scene 4 (6.0–9.0s): the answer streams in above: Two cities per the sprint notes — four per the proposal. A direct conflict on pilot breadth. Two source chips snap in beneath as it completes: 2026-05-12-sprint-notes.md — Scope decision, line 34 · Vendor-Proposal-Tidefield.pdf — p.7, Recommended scope. Hold.

## Frame 3 — Proof

- scene: Click the first source chip; the view slides to the opened note with line 34 highlighted, then a glance at the PDF opening on page 7
- duration: 8s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-proof.html
- type: key_feature
- persuasion: Show-don-tell proof
- beat: clarity → confidence
- blueprint: camera-journey (action roundtrip)
- asset_candidates:
- poster: 5s

narrativeRole: The proof beat and the heart of the video. One click on the cited source opens the real document at the exact place — heading, line 34 — then the PDF lands on page 7. The claim and its origin sit in one view.
keyMessage: Every claim opens its own source — note, heading, line, PDF page.

Scene 1 (0.0–1.8s): asymmetric 30/70 — source chips column left, note surface right. Chip one carries a live purple focus ring; the note surface shows faint text with line 34 empty.
Scene 2 (1.8–4.2s): cursor clicks the chip — the camera slides right to the note view and line 34 draws its purple highlight sweep left-to-right: Scope decision — line 34. On-screen caption sets in the lower-left of the upper band: Every claim, sourced.
Scene 3 (4.2–6.2s): travel leg two — the view slides to the PDF surface opening on page 7, the Recommended scope paragraph highlights under a mono page label: Vendor-Proposal-Tidefield.pdf — p.7.
Scene 4 (6.2–8.0s): split-screen settle — note (left) and PDF (right) share the frame, each with its highlight held; a thin hairline bisects. Hold.

## Frame 4 — Honest

- scene: Two status badges side by side: a filled-dot Verified chip and a diamond Needs review chip, each with its one-line reason
- duration: 4.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-honest.html
- type: key_feature
- persuasion: Risk reversal
- beat: confidence → trust
- blueprint: comparison-split
- asset_candidates:
- poster: 2.5s

narrativeRole: Honesty as a feature. Passages the tool verified are marked Verified; passages needing a human eye are flagged Needs review. Trust is built by showing the seam.
keyMessage: Verified — or flagged for review. The tool tells you which.

Scene 1 (0.0–1.8s): split-screen. Left card builds: filled tone dot ● in a soft success tint, label Verified, reason line fades in: cited passage matches the current note.
Scene 2 (1.8–3.2s): right card builds in the same rhythm: diamond tone mark ◆ in a soft caution tint, label Needs review, reason line: confirm the PDF section against the note context.
Scene 3 (3.2–4.5s): both cards settle; a single hairline between them; hold — the calm breather.

## Frame 5 — Draft

- scene: The cited sentence with its source refs inserts into an active note; the cursor blinks on the next line as the draft begins
- duration: 4.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/05-draft.html
- type: benefits
- persuasion: Feature-to-benefit translation
- beat: trust → ease
- blueprint: cursor-ui-demo
- asset_candidates:
- poster: 2.5s

narrativeRole: From answer to work. Research does not dead-end in chat; one action inserts the cited sentence into the active note and the cursor waits on the next line. The draft starts from evidence.
keyMessage: Your next draft starts with what you already know.

Scene 1 (0.0–1.4s): asymmetric 50/50 — chat surface left with the conflict sentence and its two source refs; empty active note right with a faint insertion caret.
Scene 2 (1.4–3.0s): cursor lands the Insert action — the cited sentence flies from chat into the note and sets as text: Sprint notes limit the pilot to two cities; the proposal recommends four ([[2026-05-12-sprint-notes]] L34, [[Vendor-Proposal-Tidefield.pdf]] p.7).
Scene 3 (3.0–4.5s): cursor drops to the next line and blinks once; caption slides up beneath: Your draft starts with evidence. Hold.

## Frame 6 — Breadth

- scene: A tidy grid assembles file-type chips PDF, EPUB, DOCX, PPTX, XLSX, HWPX, scanned OCR, then two trust chips slide in beneath
- duration: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/06-breadth.html
- type: benefits
- persuasion: Value stacking
- beat: ease → control
- blueprint: grid-card-assemble
- asset_candidates:
- poster: 3s

narrativeRole: Quiet breadth. Nothing needs migrating to Markdown: every document type reads, search and OCR run on-device, the plugin is free and open source, and vault tools stay read-only.
keyMessage: All your formats, your device, your control — free and open source.

Scene 1 (0.0–2.4s): full-width strip — seven mono file-type chips stagger-assemble into a centered grid (fade + short slide), each with a small drawn file icon.
Scene 2 (2.4–4.0s): two trust chips slide in beneath the grid: Local search and OCR stay on your device. / Free and open source. Read-only vault tools.
Scene 3 (4.0–5.0s): grid settles; hold — no float, no parallax.

## Frame 7 — Install

- scene: Calm end-card chain: tagline line, then Install in Obsidian button, then the Superpower Inside wordmark held to the end
- duration: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/07-install.html
- type: cta
- persuasion: Future pacing
- beat: control → urgency-to-act
- blueprint: titlecard-reveal (hard-cut card chain)
- asset_candidates:
- poster: 3s

narrativeRole: Land the promise and the action. The tagline restates the thesis as a future, then the single verb: install. The wordmark holds to the final frame.
keyMessage: Your next draft starts with what you already know — install it now.

Scene 1 (0.0–1.8s): centered dark card — serif display line sets with one smooth fade-up: Your next draft starts with what you already know.
Scene 2 (1.8–3.2s): hard cut — centered CTA card: Install in Obsidian button, the single purple accent of the frame; a mono hint line beneath: obsidian.md/plugins/superpower-inside.
Scene 3 (3.2–5.0s): hard cut — brand lockup: wordmark Superpower Inside with a thin purple underline stroke; hold to the final frame.

## 2026-10-13 · README와 제품 철학 반영

- 현재 README.md의 작업 중심 소개와 product-philosophy.md의 최소 관여·맥락 연결을 기준으로 개정한다.
- 핵심 메시지: 내 자료에서, 다음 작업으로. 필요한 결과를 이야기하고, 관련 구간을 연결하고, 필요할 때 근거를 확인하고, 같은 대화에서 결과를 활용한다.
- 기존 1920×1080·41초·한영 파생본·무음·차분한 편집 톤을 유지한다.
- 모든 답변에 출처가 있다는 약속은 하지 않는다. 출처 확인이 정확성 보증이라는 표현을 쓰지 않는다.
- 답변은 모아서 수신한다. 결과 삽입은 사용자가 선택한다. 로컬 검색/OCR과 원격 채팅의 데이터 경계를 구분한다.
- 기존 합성 예시는 설명용 그래픽이며 실제 제품 녹화나 실제 모델 성능의 증거가 아니다.

### 개정 장면 · 41초

1. 0–5초: 필요한 결과로 시작하기.
2. 5–14초: 질문에서 관련 구간과 출처로. 답변은 한 번에 수신.
3. 14–22초: 중요한 주장에 대해 원문 확인.
4. 22–26.5초: 같은 대화에서 비교를 개요로 활용.
5. 26.5–31초: 원할 때 복사·삽입·저장.
6. 31–36초: 지원 문서와 로컬 검색/OCR, 제공자별 데이터 처리.
7. 36–41초: 내 자료에서 다음 작업으로. 설치와 제공자 비용 조건.

## 2026-10-14 · 사용 가치 중심 재설계

- 사용자 요청: 폰트·디자인 전면 개정, 하단 재현 데모 표기 제거, 중요한 가치에 집중된 효과, 작동 원리보다 사용자 성과와 제품 방향성, 길이 확장 허용.
- 72초·1920×1080·한영·나레이션 없음. 기존 제품 화면 재현과 가상 파일 예시는 전부 제거한다.
- 현재 기능 약속: README의 프로젝트 복귀·비교·집필·근거 확인·모델 선택. 지향점은 제품 철학 P01·P04·P09에서 가져오며 '우리가 만드는 경험'으로 구분한다.
- 이전 41초: 어두운 에디터·얇은 세리프·절차 시연. 이번 72초: 따뜻한 밝은 배경·굵은 Pretendard/Inter·사용 가치 장면·핵심 3회 강조.
- 조사: Google ABCD https://support.google.com/google-ads/answer/14783551?hl=en , Wistia https://wistia.com/blog/optimal-video-length . 72초는 이 제품의 읽기·서사 길이를 고려한 제작 판단이며 보편적 최적 길이로 주장하지 않는다.
- 장면: 0–7 다음 생각 / 7–14 필요한 결과 / 14–23 프로젝트 복귀 / 23–32 비교 / 32–40 근거 / 40–50 글쓰기 / 50–58 방향성 / 58–64 선택 / 64–72 설치.
- 효과: marker-highlight 밑줄을 다음 생각·판단의 근거·생각에 쓸 여유에만 적용한다. 방향성 장면에서는 배경으로 물러나는 준비와 또렷한 생각을 선택적 초점으로 구분한다.
