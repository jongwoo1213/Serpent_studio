"use client";

import {
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CardKind,
  getCardData,
  parseSerpentInput,
  SAMPLE_INPUT,
  serializeCards,
  SerpentCard,
  updateCard,
  validateSerpentInput,
} from "../lib/serpent";

const GROUPS: { label: string; kinds: CardKind[] }[] = [
  { label: "형상", kinds: ["surface", "cell", "other"] },
  { label: "물질", kinds: ["material"] },
  { label: "계산 조건", kinds: ["title", "setting", "plot"] },
  { label: "소스 및 검출기", kinds: ["source", "detector"] },
  { label: "파일", kinds: ["include"] },
];

const CARD_TEMPLATES: Record<string, string> = {
  surface: "\n% --- New surface\nsurf new_surface cyl 0.0 0.0 1.0\n",
  cell: "\n% --- New cell\ncell new_cell 0 void -new_surface\n",
  material: "\n% --- New material\nmat new_material -1.0\n1001.09c 1.0\n",
  setting: "\nset pop 5000 100 20\n",
  detector: "\ndet new_detector de energy_grid\n",
  source: "\nsrc new_source sp 0 0 0\n",
  plot: "\ngplot 3 700 700\n",
};

function Icon({ children }: { children: string }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function fieldLabel(card: SerpentCard, key: string) {
  const labels: Record<string, string> = {
    name:
      card.kind === "surface" ? "표면 이름" :
      card.kind === "cell" ? "셀 이름" :
      card.kind === "material" ? "물질 이름" : "옵션",
    type: "표면 형식",
    values: card.kind === "surface" ? "파라미터" : "값",
    universe: "Universe",
    material: "물질 / Fill",
    region: "영역 표현식",
    density: "밀도",
    options: "물질 옵션",
    composition: "핵종 조성",
    comment: "설명",
  };
  return labels[key] ?? key;
}

function formatKind(kind: CardKind) {
  return {
    surface: "SURFACE",
    cell: "CELL",
    material: "MATERIAL",
    setting: "SETTING",
    title: "TITLE",
    plot: "PLOT",
    source: "SOURCE",
    detector: "DETECTOR",
    include: "INCLUDE",
    other: "CARD",
  }[kind];
}

export default function Home() {
  const [source, setSource] = useState(SAMPLE_INPUT);
  const [fileName, setFileName] = useState("pwr_pin.inp");
  const [selectedId, setSelectedId] = useState<string>("");
  const [view, setView] = useState<"builder" | "source">("builder");
  const [panel, setPanel] = useState<"preview" | "issues">("preview");
  const [showAdd, setShowAdd] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const cards = useMemo(() => parseSerpentInput(source), [source]);
  const issues = useMemo(() => validateSerpentInput(cards), [cards]);
  const selected = cards.find((card) => card.id === selectedId) ?? cards.find((card) => card.kind === "surface") ?? cards[0];
  const selectedData = selected ? getCardData(selected) : {};
  const errors = issues.filter((issue) => issue.level === "error").length;

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  function replaceCard(card: SerpentCard) {
    const next = cards.map((item) => (item.id === card.id ? card : item));
    setSource(serializeCards(next));
  }

  function handleField(key: string, value: string) {
    if (!selected) return;
    replaceCard(updateCard(selected, { ...selectedData, [key]: value } as Record<string, string>));
  }

  function addCard(type: string) {
    const nextSource = source.trimEnd() + (CARD_TEMPLATES[type] ?? "");
    setSource(nextSource);
    const nextCards = parseSerpentInput(nextSource);
    setSelectedId(nextCards[nextCards.length - 1]?.id ?? "");
    setShowAdd(false);
    setView("builder");
  }

  function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSource(String(reader.result ?? ""));
      setFileName(file.name);
      setSelectedId("");
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function downloadInput() {
    const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function runValidation() {
    setLogOpen(true);
    setPanel(issues.length ? "issues" : "preview");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>SERPENT Studio</strong>
            <span>INPUT MODEL BUILDER</span>
          </div>
        </div>
        <div className="file-pill">
          <Icon>▤</Icon>
          <input
            aria-label="파일 이름"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
          />
          <span className="saved-dot" />
          <span>편집 중</span>
        </div>
        <div className="top-actions">
          <input ref={fileInput} type="file" accept=".inp,.txt,*" hidden onChange={openFile} />
          <button className="button ghost" onClick={() => fileInput.current?.click()}>
            <Icon>↥</Icon> 열기
          </button>
          <button className="button ghost" onClick={downloadInput}>
            <Icon>↓</Icon> 내보내기
          </button>
          <button className="button primary" onClick={runValidation}>
            <Icon>▶</Icon> 입력 검사
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>모델 구성</span>
            <button className="icon-button" aria-label="카드 추가" onClick={() => setShowAdd(!showAdd)}>＋</button>
          </div>
          {showAdd && (
            <div className="add-menu">
              {Object.keys(CARD_TEMPLATES).map((key) => (
                <button key={key} onClick={() => addCard(key)}>
                  <Icon>＋</Icon>{formatKind(key as CardKind)}
                </button>
              ))}
            </div>
          )}
          <nav className="model-tree" aria-label="Serpent 카드">
            {GROUPS.map((group) => {
              const groupCards = cards.filter((card) => group.kinds.includes(card.kind));
              if (!groupCards.length) return null;
              return (
                <div className="tree-group" key={group.label}>
                  <div className="tree-label">
                    <span>{group.label}</span>
                    <span>{groupCards.length}</span>
                  </div>
                  {groupCards.map((card) => (
                    <button
                      key={card.id}
                      className={selected?.id === card.id ? "tree-item active" : "tree-item"}
                      onClick={() => { setSelectedId(card.id); setView("builder"); }}
                    >
                      <span className={`kind-dot ${card.kind}`} />
                      <span className="tree-name">{card.label || card.keyword}</span>
                      <span className="tree-line">L{card.startLine}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="project-health">
            <div className="health-row">
              <span>모델 상태</span>
              <strong className={errors ? "bad" : "good"}>{errors ? `${errors} 오류` : "정상"}</strong>
            </div>
            <div className="health-meter"><span style={{ width: errors ? "64%" : "100%" }} /></div>
            <small>{cards.length}개 카드 · Serpent 2 형식</small>
          </div>
        </aside>

        <section className="editor-pane">
          <div className="editor-tabs">
            <button className={view === "builder" ? "active" : ""} onClick={() => setView("builder")}>
              구조화 편집
            </button>
            <button className={view === "source" ? "active" : ""} onClick={() => setView("source")}>
              원문 입력
            </button>
            <div className="undo-group">
              <button className="icon-button" title="샘플로 되돌리기" onClick={() => setSource(SAMPLE_INPUT)}>↶</button>
            </div>
          </div>

          {view === "source" ? (
            <div className="source-editor">
              <div className="source-toolbar">
                <span>Serpent 2 input</span>
                <span>{source.split("\n").length} lines</span>
              </div>
              <textarea
                aria-label="Serpent 원문 입력"
                spellCheck={false}
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </div>
          ) : selected ? (
            <div className="form-editor">
              <div className="card-header">
                <div>
                  <span className="eyebrow">{formatKind(selected.kind)}</span>
                  <h1>{selected.label}</h1>
                  <p>입력 카드의 값을 수정하면 Serpent 원문에 바로 반영됩니다.</p>
                </div>
                <span className="line-badge">LINE {selected.startLine}</span>
              </div>

              <div className="form-grid">
                {Object.entries(selectedData).map(([key, value]) => {
                  const wide = ["values", "region", "composition", "comment"].includes(key);
                  const multiline = key === "composition";
                  return (
                    <label className={wide ? "field wide" : "field"} key={`${selected.id}-${key}`}>
                      <span>{fieldLabel(selected, key)}</span>
                      {multiline ? (
                        <textarea
                          value={value}
                          spellCheck={false}
                          onChange={(event) => handleField(key, event.target.value)}
                        />
                      ) : (
                        <input value={value} onChange={(event) => handleField(key, event.target.value)} />
                      )}
                      {key === "density" && <small>음수는 질량 밀도(g/cm³), 양수는 원자 밀도입니다.</small>}
                      {key === "region" && <small>음수는 표면 내부, 양수는 표면 외부를 뜻합니다.</small>}
                    </label>
                  );
                })}
              </div>

              <div className="raw-card">
                <div>
                  <span>생성된 입력 카드</span>
                  <small>원문 입력 탭에서도 직접 수정할 수 있습니다.</small>
                </div>
                <code>{selected.lines.filter((line) => line.trim()).join("\n")}</code>
              </div>
            </div>
          ) : (
            <div className="empty-state">편집할 카드를 선택하세요.</div>
          )}
        </section>

        <aside className="inspector">
          <div className="inspector-tabs">
            <button className={panel === "preview" ? "active" : ""} onClick={() => setPanel("preview")}>형상 미리보기</button>
            <button className={panel === "issues" ? "active" : ""} onClick={() => setPanel("issues")}>
              검사 결과 <span>{issues.length}</span>
            </button>
          </div>
          {panel === "preview" ? (
            <GeometryPreview cards={cards} />
          ) : (
            <div className="issues">
              <div className="issue-summary">
                <div className={errors ? "summary-icon error" : "summary-icon"}>{errors ? "!" : "✓"}</div>
                <div>
                  <strong>{errors ? "입력을 확인해 주세요" : "치명적인 오류가 없습니다"}</strong>
                  <span>{errors} errors · {issues.length - errors} warnings</span>
                </div>
              </div>
              {issues.length ? issues.map((issue, index) => (
                <button
                  className={`issue ${issue.level}`}
                  key={`${issue.message}-${index}`}
                  onClick={() => issue.cardId && setSelectedId(issue.cardId)}
                >
                  <span>{issue.level === "error" ? "×" : "!"}</span>
                  <div><strong>{issue.level === "error" ? "오류" : "권장 사항"}</strong><p>{issue.message}</p></div>
                </button>
              )) : (
                <div className="all-clear">모든 기본 검사를 통과했습니다.</div>
              )}
            </div>
          )}
        </aside>
      </section>

      <footer className="statusbar">
        <div><span className={errors ? "status-light error" : "status-light"} /> {errors ? "검사 필요" : "기본 검증 통과"}</div>
        <div className="status-center"><span>Surfaces {cards.filter((c) => c.kind === "surface").length}</span><span>Cells {cards.filter((c) => c.kind === "cell").length}</span><span>Materials {cards.filter((c) => c.kind === "material").length}</span></div>
        <button onClick={() => setLogOpen(!logOpen)}>⌃ 실행 콘솔</button>
      </footer>

      {logOpen && (
        <div className="console">
          <div className="console-head"><span>입력 검사 콘솔</span><button onClick={() => setLogOpen(false)}>×</button></div>
          <pre>
{`SERPENT Studio validator
Reading ${fileName}...
Parsed ${cards.length} input cards.
${errors ? `Found ${errors} error(s) and ${issues.length - errors} warning(s).` : `No blocking errors found. ${issues.length} recommendation(s).`}

브라우저 버전에서는 문법과 참조 무결성을 검사합니다.
정식 계산 전에는 설치된 Serpent에서 입력 검사를 다시 수행하세요.`}
          </pre>
        </div>
      )}
    </main>
  );
}

function GeometryPreview({ cards }: { cards: SerpentCard[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const surfaces = cards
    .filter((card) => card.kind === "surface")
    .map((card) => ({ card, data: getCardData(card) }))
    .filter(({ data }) => "type" in data && ["cyl", "sqc"].includes(data.type));

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    element.width = width * ratio;
    element.height = height * ratio;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#071714";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(105, 166, 149, .12)";
    context.lineWidth = 1;
    for (let x = 18; x < width; x += 22) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let y = 18; y < height; y += 22) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }

    const cx = width / 2;
    const cy = height / 2;
    const scale = Math.min(width, height) * 0.33;
    const circles = surfaces
      .filter(({ data }) => "type" in data && data.type === "cyl")
      .map(({ data }) => Number(("values" in data ? data.values : "").split(/\s+/).at(-1)))
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
    const maxRadius = circles[0] || 1;
    const palette = ["#437d75", "#d9e3d6", "#c58b54", "#eec88c"];

    circles.forEach((radius, index) => {
      context.beginPath();
      context.arc(cx, cy, (radius / maxRadius) * scale, 0, Math.PI * 2);
      context.fillStyle = palette[index % palette.length] ?? "#437d75";
      context.fill();
      context.strokeStyle = "#102c27";
      context.lineWidth = 1.5;
      context.stroke();
    });

    const square = surfaces.find(({ data }) => "type" in data && data.type === "sqc");
    if (square && "values" in square.data) {
      const half = Number(square.data.values.split(/\s+/).at(-1)) || maxRadius * 1.25;
      const size = (half / maxRadius) * scale * 2;
      context.strokeStyle = "#91c9b7";
      context.lineWidth = 2;
      context.strokeRect(cx - size / 2, cy - size / 2, size, size);
    }

    context.strokeStyle = "rgba(255,255,255,.35)";
    context.setLineDash([3, 4]);
    context.beginPath(); context.moveTo(cx, 24); context.lineTo(cx, height - 24); context.stroke();
    context.beginPath(); context.moveTo(24, cy); context.lineTo(width - 24, cy); context.stroke();
    context.setLineDash([]);
  }, [cards, surfaces]);

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <div className="segmented"><button className="active">XY</button><button>XZ</button><button>YZ</button></div>
        <span>z = 0.000 cm</span>
        <button className="icon-button" title="뷰 맞춤">⊙</button>
      </div>
      <div className="canvas-wrap">
        <canvas ref={canvas} aria-label="Serpent 형상 2D 미리보기" />
        <div className="axis x">X</div>
        <div className="axis y">Y</div>
        <div className="zoom">＋<span />−</div>
      </div>
      <div className="legend">
        <div className="legend-head"><strong>표면 레이어</strong><span>{surfaces.length}</span></div>
        {surfaces.map(({ card, data }, index) => (
          <div className="legend-item" key={card.id}>
            <span style={{ background: ["#437d75", "#d9e3d6", "#c58b54", "#eec88c"][index % 4] }} />
            <div><strong>{data.name}</strong><small>{"type" in data ? data.type : card.keyword}</small></div>
            <code>{"values" in data ? data.values.split(/\s+/).at(-1) : ""}</code>
          </div>
        ))}
        {!surfaces.length && <p className="no-preview">cyl 또는 sqc 표면을 추가하면 여기에 표시됩니다.</p>}
      </div>
      <p className="preview-note">빠른 개념 미리보기입니다. 최종 형상은 Serpent의 gplot 결과로 확인하세요.</p>
    </div>
  );
}
