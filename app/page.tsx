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
  const boundaries = useMemo(() => {
    return cards
      .filter((card) => card.kind === "surface")
      .map((card) => {
        const data = getCardData(card);
        const values = data.values.split(/\s+/).map(Number);
        const distance = values.at(-1) ?? 0;
        return {
          card,
          name: data.name,
          type: data.type,
          distance,
          centerX: values.length >= 3 ? values[0] ?? 0 : 0,
          centerY: values.length >= 3 ? values[1] ?? 0 : 0,
        };
      })
      .filter((boundary) => ["cyl", "sqc"].includes(boundary.type) && Number.isFinite(boundary.distance));
  }, [cards]);

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
    const scale = Math.min(width, height) * 0.28;
    const maxDistance = Math.max(...boundaries.map((boundary) => boundary.distance), 1);
    const palette = ["#437d75", "#d9e3d6", "#c58b54", "#eec88c"];
    const circles = boundaries
      .filter((boundary) => boundary.type === "cyl")
      .sort((a, b) => b.distance - a.distance);

    circles.forEach((boundary, index) => {
      const radius = (boundary.distance / maxDistance) * scale;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fillStyle = palette[index % palette.length] ?? "#437d75";
      context.fill();
      context.strokeStyle = "#102c27";
      context.lineWidth = 1.5;
      context.stroke();
    });

    const squares = boundaries.filter((boundary) => boundary.type === "sqc");
    squares.forEach((boundary) => {
      const half = (boundary.distance / maxDistance) * scale;
      const size = half * 2;
      context.strokeStyle = "#91c9b7";
      context.lineWidth = 2;
      context.strokeRect(cx - size / 2, cy - size / 2, size, size);
    });

    context.strokeStyle = "rgba(255,255,255,.35)";
    context.setLineDash([3, 4]);
    context.beginPath(); context.moveTo(cx, 24); context.lineTo(cx, height - 24); context.stroke();
    context.beginPath(); context.moveTo(24, cy); context.lineTo(width - 24, cy); context.stroke();
    context.setLineDash([]);

    const drawArrow = (x: number, y: number, angle: number, color: string) => {
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(-6, -3);
      context.lineTo(-6, 3);
      context.closePath();
      context.fillStyle = color;
      context.fill();
      context.restore();
    };

    [...boundaries]
      .sort((a, b) => a.distance - b.distance)
      .forEach((boundary, index) => {
        const angle = boundary.type === "sqc"
          ? -Math.PI / 2
          : -0.22 - index * 0.28;
        const length = (boundary.distance / maxDistance) * scale;
        const endX = cx + Math.cos(angle) * length;
        const endY = cy + Math.sin(angle) * length;
        const color = index % 2 ? "#f4d399" : "#b7e0d1";

        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = 1;
        context.setLineDash([2, 2]);
        context.beginPath();
        context.moveTo(cx, cy);
        context.lineTo(endX, endY);
        context.stroke();
        context.setLineDash([]);
        drawArrow(endX, endY, angle, color);

        const label = `${boundary.name}  ${boundary.distance.toFixed(4)} cm`;
        context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
        const labelWidth = context.measureText(label).width + 8;
        const labelX = Math.min(Math.max(endX + 7, 5), width - labelWidth - 5);
        const labelY = Math.min(Math.max(endY - 13, 14), height - 8);
        context.fillStyle = "rgba(4, 22, 18, .86)";
        context.fillRect(labelX - 3, labelY - 9, labelWidth, 13);
        context.fillStyle = color;
        context.fillText(label, labelX, labelY);
      });

    context.fillStyle = "#eff8f4";
    context.beginPath();
    context.arc(cx, cy, 2.5, 0, Math.PI * 2);
    context.fill();
  }, [boundaries]);

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <div className="segmented"><button className="active">XY</button><button>XZ</button><button>YZ</button></div>
        <span>z = 0.000 cm</span>
        <span className="dimension-unit">단위 cm</span>
      </div>
      <div className="canvas-wrap">
        <canvas ref={canvas} aria-label="경계 치수가 표시된 Serpent XY 평면도" />
        <div className="axis x">X</div>
        <div className="axis y">Y</div>
        <div className="origin-label">원점 (0, 0)</div>
      </div>
      <div className="legend">
        <div className="legend-head"><strong>구분 경계 치수</strong><span>{boundaries.length}</span></div>
        <div className="dimension-table-head">
          <span>경계</span><span>형식</span><span>중심 → 경계</span><span>전체 치수</span>
        </div>
        {boundaries.map((boundary, index) => (
          <div className="dimension-row" key={boundary.card.id}>
            <span style={{ background: ["#437d75", "#d9e3d6", "#c58b54", "#eec88c"][index % 4] }} />
            <strong>{boundary.name}</strong>
            <code>{boundary.type}</code>
            <code>{boundary.distance.toFixed(4)} cm</code>
            <code>{boundary.type === "cyl" ? "Ø" : "W"} {(boundary.distance * 2).toFixed(4)} cm</code>
          </div>
        ))}
        {!boundaries.length && <p className="no-preview">cyl 또는 sqc 표면을 추가하면 치수 평면도가 표시됩니다.</p>}
      </div>
      <p className="preview-note">점선 치수선은 각 표면 중심에서 구분 경계까지의 거리입니다. Ø는 원형 직경, W는 사각형 전체 폭입니다.</p>
    </div>
  );
}
