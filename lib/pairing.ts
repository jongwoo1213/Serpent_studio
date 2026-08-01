/**
 * 입력문과 결과문(_res.m)을 이름으로 짝지어 준다.
 *
 * Serpent 는 입력문 X 를 돌리면 같은 폴더에 X_res.m, X.out, X.seed 를 남긴다.
 * 그래서 파일 이름에서 접미사만 떼면 둘을 이어붙일 수 있다.
 *
 * 다만 브라우저는 파일 하나를 고를 때 같은 폴더의 다른 파일을 볼 수 없다.
 * 폴더를 통째로 고르거나(webkitdirectory), 여러 개를 함께 고르거나,
 * 끌어다 놓는 경우에만 짝을 찾을 수 있다.
 */

export type FileKind = "result" | "input" | "ignored";

export type IngestedFile = {
  /** 파일 이름 (경로 제외). */
  name: string;
  /**
   * 같은 폴더인지 판단하기 위한 디렉터리 경로. 단일 선택이면 빈 문자열.
   *
   * 브라우저는 보안상 실제 절대 경로를 절대 알려주지 않는다. 폴더를 통째로 고르거나
   * 끌어다 놓았을 때 얻는 상대 경로가 전부이므로, 재현에 필요한 전체 경로는
   * 사용자가 직접 적어 보완해야 한다.
   */
  dir: string;
  text: string;
  /** 파일 수정 시각 (epoch ms). 브라우저가 알려주지 않으면 undefined. */
  lastModified?: number;
};

/** Serpent 가 함께 뱉지만 이 도구가 다루지 않는 산출물. */
const SIDECAR_NAME = /(_dep|_det\d*|_his|_coe|_sens|_mdx|_core)\.m$/i;
const SIDECAR_EXT = /\.(out|seed|png|jpe?g|gif|svg|log|zip|gz|pdf|csv)$/i;

const RESULT_SUFFIX = /_res\.m$/i;
/** res.m 은 모든 값이 `NAME (idx, ...) = ...` 형태라 이 한 줄로 확실히 식별된다. */
const RESULT_BODY = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*idx\s*,/m;

const INPUT_EXT = /\.(inp|input|i|txt|serpent|sss|dat)$/i;
/** 입력문이라면 최소한 카드 한 줄은 있어야 한다. */
const INPUT_BODY = /^\s*(set|surf|cell|mat|pin|lat|dep|det|src|therm|plot|include|trans|ene)\s+\S/m;

export function classifyFile(name: string, text: string): FileKind {
  if (RESULT_SUFFIX.test(name) || RESULT_BODY.test(text)) return "result";
  if (SIDECAR_NAME.test(name) || SIDECAR_EXT.test(name)) return "ignored";
  if (INPUT_BODY.test(text)) return "input";
  return "ignored";
}

/** 짝을 맞추기 위한 이름. 결과문은 _res.m 을, 입력문은 확장자를 뗀다. */
export function baseName(name: string, kind: FileKind) {
  if (kind === "result") return name.replace(RESULT_SUFFIX, "");
  return name.replace(INPUT_EXT, "");
}

/** 같은 폴더의 같은 이름끼리만 이어야 하므로 디렉터리까지 포함해 키를 만든다. */
export function pairKey(file: IngestedFile, kind: FileKind) {
  return `${file.dir}␟${baseName(file.name, kind)}`;
}

export type IngestResult = {
  results: IngestedFile[];
  inputs: IngestedFile[];
  ignored: string[];
  /** pairKey → 같은 이름의 입력문. 결과문에서 입력문을 찾을 때 쓴다. */
  inputByKey: Map<string, IngestedFile>;
  /** pairKey → 같은 이름의 결과문. */
  resultByKey: Map<string, IngestedFile>;
};

export function ingest(files: IngestedFile[]): IngestResult {
  const results: IngestedFile[] = [];
  const inputs: IngestedFile[] = [];
  const ignored: string[] = [];
  const inputByKey = new Map<string, IngestedFile>();
  const resultByKey = new Map<string, IngestedFile>();

  for (const file of files) {
    const kind = classifyFile(file.name, file.text);
    if (kind === "result") {
      results.push(file);
      resultByKey.set(pairKey(file, kind), file);
    } else if (kind === "input") {
      inputs.push(file);
      inputByKey.set(pairKey(file, kind), file);
    } else {
      ignored.push(file.name);
    }
  }

  return { results, inputs, ignored, inputByKey, resultByKey };
}

/** 브라우저가 준 상대 경로에서 폴더 부분만 뽑는다. */
export function directoryOf(file: File) {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!relative) return "";
  const cut = relative.lastIndexOf("/");
  return cut < 0 ? "" : relative.slice(0, cut);
}

export async function readFiles(files: File[]): Promise<IngestedFile[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      dir: directoryOf(file),
      text: await file.text(),
      lastModified: file.lastModified || undefined,
    })),
  );
}

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (cb: (file: File) => void, err: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (entries: FileSystemEntryLike[]) => void, err: (error: unknown) => void) => void };
};

/**
 * 끌어다 놓은 항목을 훑는다. 폴더를 통째로 놓는 경우를 지원하려면
 * DataTransferItem 의 엔트리 API 를 써야 한다.
 */
export async function readDropped(items: DataTransferItemList): Promise<IngestedFile[]> {
  const roots: FileSystemEntryLike[] = [];
  const plain: File[] = [];

  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null })
      .webkitGetAsEntry?.();
    if (entry) roots.push(entry);
    else {
      const file = item.getAsFile();
      if (file) plain.push(file);
    }
  }

  if (!roots.length) return readFiles(plain);

  const collected: IngestedFile[] = [];

  const readEntry = async (entry: FileSystemEntryLike, dir: string): Promise<void> => {
    if (entry.isFile && entry.file) {
      const file = await new Promise<File | null>((resolve) =>
        entry.file!((value) => resolve(value), () => resolve(null)),
      );
      if (file) {
        collected.push({
          name: file.name,
          dir,
          text: await file.text(),
          lastModified: file.lastModified || undefined,
        });
      }
      return;
    }
    if (!entry.isDirectory || !entry.createReader) return;

    const reader = entry.createReader();
    const childDir = dir ? `${dir}/${entry.name}` : entry.name;
    // readEntries 는 한 번에 일부만 돌려주므로 빈 배열이 올 때까지 반복해야 한다.
    for (;;) {
      const batch = await new Promise<FileSystemEntryLike[]>((resolve) =>
        reader.readEntries((entries) => resolve(entries), () => resolve([])),
      );
      if (!batch.length) break;
      for (const child of batch) await readEntry(child, childDir);
    }
  };

  for (const root of roots) await readEntry(root, "");
  return collected;
}
