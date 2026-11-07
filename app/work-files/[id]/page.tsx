"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import InactivityAutoLock from "@/components/security/InactivityAutoLock";
import ScreenLightLocker from "@/components/security/ScreenLightLocker";


type WorkFileStatus = "Working" | "Saved" | "Completed";

type WorkFile = {
  id: string;
  user_id?: string;
  category: string;
  file_name: string;
  content: string;
  status: WorkFileStatus;
  created_at?: string;
  updated_at: string;
};

type GridRows = string[][];
type GridHeaders = string[];

const DEFAULT_GRID: GridRows = [
  ["", "", ""],
  ["", "", ""],
  ["", "", ""],
  ["", "", ""],
  ["", "", ""],
];

const DEFAULT_GRID_HEADERS: GridHeaders = [
  "Column 1",
  "Column 2",
  "Column 3",
];

function cloneGrid(rows: GridRows): GridRows {
  return rows.map((row) => [...row]);
}

function serializeGrid(rows: GridRows): string {
  return JSON.stringify(rows);
}

function createDefaultGrid(): GridRows {
  return cloneGrid(DEFAULT_GRID);
}

function cloneGridHeaders(
  headers: GridHeaders
): GridHeaders {
  return [...headers];
}

function createDefaultGridHeaders(): GridHeaders {
  return cloneGridHeaders(
    DEFAULT_GRID_HEADERS
  );
}

function normalizeGridHeaders(
  value: unknown,
  columnCount: number
): GridHeaders {
  const count = Math.max(1, columnCount);
  const input = Array.isArray(value)
    ? value.map((v) => String(v ?? "").trim())
    : [];

  return Array.from(
    { length: count },
    (_, index) =>
      input[index] ||
      `Column ${index + 1}`
  );
}

function createGridHeadersForRows(
  rows: GridRows
): GridHeaders {
  const count = Math.max(
    1,
    ...rows.map((row) => row.length)
  );

  return normalizeGridHeaders(
    undefined,
    count
  );
}

function normalizeGrid(value: unknown): GridRows {
  if (!Array.isArray(value) || value.length === 0) {
    return createDefaultGrid();
  }

  const rows = value
    .filter(Array.isArray)
    .map((row) => row.map((cell) => String(cell ?? "")));

  if (rows.length === 0) {
    return createDefaultGrid();
  }

  const columnCount = Math.max(
    1,
    ...rows.map((row) => row.length)
  );

  return rows.map((row) => {
    const normalized = [...row];

    while (normalized.length < columnCount) {
      normalized.push("");
    }

    return normalized.slice(0, columnCount);
  });
}

function parseWorkFileContent(
  rawContent: string
): {
  editorContent: string;
  gridRows: GridRows;
  gridHeaders: GridHeaders;
} {
  if (!rawContent) {
    return {
      editorContent: "",
      gridRows: createDefaultGrid(),
      gridHeaders:
        createDefaultGridHeaders(),
    };
  }

  try {
    const parsed = JSON.parse(rawContent);

    if (
      parsed &&
      (parsed.version === 1 ||
        parsed.version === 2) &&
      Array.isArray(parsed.gridRows)
    ) {
      const gridRows =
        normalizeGrid(parsed.gridRows);

      return {
        editorContent:
          typeof parsed.editorContent ===
          "string"
            ? parsed.editorContent
            : "",
        gridRows,
        gridHeaders:
          normalizeGridHeaders(
            parsed.gridHeaders,
            gridRows[0]?.length || 1
          ),
      };
    }
  } catch {
    // Existing plain-text work file.
  }

  const gridRows = createDefaultGrid();

  return {
    editorContent: rawContent,
    gridRows,
    gridHeaders:
      createGridHeadersForRows(gridRows),
  };
}

function serializeWorkFileContent(
  editorContent: string,
  gridRows: GridRows,
  gridHeaders: GridHeaders
): string {
  const columnCount = Math.max(
    1,
    ...gridRows.map((row) => row.length)
  );

  return JSON.stringify({
    version: 2,
    editorContent,
    gridHeaders:
      normalizeGridHeaders(
        gridHeaders,
        columnCount
      ),
    gridRows,
  });
}

function PdfJsPreview({
  pdfUrl,
  fileName,
}: {
  pdfUrl: string;
  fileName: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function renderPdf() {
      if (!pdfUrl || !containerRef.current) {
        return;
      }

      setPdfLoading(true);
      setPdfError("");

      const container = containerRef.current;
      container.innerHTML = "";

      try {
        const pdfjsLib = await import("pdfjs-dist");

        if (cancelled) {
          return;
        }

        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
        });

        const pdf = await loadingTask.promise;

        if (cancelled) {
          return;
        }

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) {
            return;
          }

          const page = await pdf.getPage(pageNumber);

          const baseViewport = page.getViewport({
            scale: 1,
          });

          const availableWidth = Math.max(
            280,
            Math.min(
              container.clientWidth - 16,
              1000
            )
          );

          const scale = Math.max(
            0.5,
            Math.min(
              availableWidth / baseViewport.width,
              2
            )
          );

          const viewport = page.getViewport({
            scale,
          });

          const pageWrapper = document.createElement("div");
          pageWrapper.className =
            "mb-4 overflow-hidden rounded-xl bg-white shadow-lg";

          const pageLabel = document.createElement("div");
          pageLabel.className =
            "border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-600";
          pageLabel.textContent =
            `${fileName} — Page ${pageNumber} of ${pdf.numPages}`;

          const canvas = document.createElement("canvas");
          canvas.className = "block h-auto w-full";
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);

          const context = canvas.getContext("2d");

          if (!context) {
            throw new Error(
              "Unable to create PDF canvas."
            );
          }

          pageWrapper.appendChild(pageLabel);
          pageWrapper.appendChild(canvas);
          container.appendChild(pageWrapper);

          await page.render({
            canvasContext: context,
            viewport,
            canvas,
          }).promise;
        }

        if (!cancelled) {
          setPdfLoading(false);
        }
      } catch (error) {
        console.error(
          "PDF.JS PREVIEW ERROR:",
          error
        );

        if (!cancelled) {
          setPdfLoading(false);
          setPdfError(
            "Unable to render this PDF in the work file."
          );
        }
      }
    }

    void renderPdf();

    return () => {
      cancelled = true;

      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [pdfUrl, fileName]);

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/70 p-2">
      {pdfLoading && (
        <div className="flex min-h-[180px] items-center justify-center text-sm text-slate-400">
          Loading PDF preview...
        </div>
      )}

      {pdfError && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-5 text-sm text-red-300">
          {pdfError}
        </div>
      )}

      <div
        ref={containerRef}
        className="mx-auto max-w-[1000px]"
      />
    </div>
  );
}

export default function WorkFileEditor() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = String(params.id);
  const sourceFileId = searchParams.get("sourceFileId");
  const isViewMode = searchParams.get("mode") === "view";

  const [workFile, setWorkFile] = useState<WorkFile | null>(null);

  const [sourceFile, setSourceFile] = useState<{
    id: string;
    file_name: string;
    category: string;
    mime_type: string | null;
    preview_url: string | null;
  } | null>(null);

    const [sourcePdfPreviewUrl, setSourcePdfPreviewUrl] =
    useState<string | null>(null);

  const [content, setContent] = useState("");
  const [workspaceMode, setWorkspaceMode] =
    useState<"docs" | "sheets">("docs");

  const [gridRows, setGridRows] = useState<GridRows>(
    createDefaultGrid()
  );

  const [gridHeaders, setGridHeaders] =
    useState<GridHeaders>(
      createDefaultGridHeaders()
    );

  const latestGridHeaders =
    useRef<GridHeaders>(
      createDefaultGridHeaders()
    );

  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [requiredWorkUnits, setRequiredWorkUnits] =
    useState<number | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteOtp, setDeleteOtp] = useState("");
  const [deleteStep, setDeleteStep] = useState<"confirm" | "otp">("confirm");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");


  const [editorCanUndo, setEditorCanUndo] = useState(false);
  const [editorCanRedo, setEditorCanRedo] = useState(false);
  const [gridCanUndo, setGridCanUndo] = useState(false);
  const [gridCanRedo, setGridCanRedo] = useState(false);

  const [selectedGridRow, setSelectedGridRow] = useState<
    number | null
  >(null);

  const [selectedGridColumn, setSelectedGridColumn] = useState<
    number | null
  >(null);

  const [gridFocusedCell, setGridFocusedCell] = useState<{
    row: number;
    column: number;
  } | null>(null);

  const [gridFilterText, setGridFilterText] = useState("");
  const [gridSortColumn, setGridSortColumn] = useState<number | null>(null);
  const [gridSortDirection, setGridSortDirection] = useState<"asc" | "desc">("asc");
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});

  const latestGridRows = useRef<GridRows>(
    createDefaultGrid()
  );

  const latestContent = useRef("");

  const editorHistory = useRef<string[]>([]);
  const editorRedo = useRef<string[]>([]);
  const editorHistoryReady = useRef(false);

  const gridHistory = useRef<string[]>([]);
  const gridRedo = useRef<string[]>([]);
  const gridHistoryReady = useRef(false);

  const gridInputRefs = useRef<
    Record<string, HTMLInputElement | null>
  >({});

  const gridEditTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const gridEditingCell = useRef<{
    row: number;
    column: number;
    before: string;
  } | null>(null);

  const focusGridCell = useCallback(
    (row: number, column: number) => {
      const input =
        gridInputRefs.current[`${row}-${column}`];

      if (!input) {
        return;
      }

      input.focus();
      input.select();

      setGridFocusedCell({
        row,
        column,
      });
    },
    []
  );

  function syncEditorHistoryState() {
    setEditorCanUndo(
      editorHistory.current.length > 1
    );
    setEditorCanRedo(
      editorRedo.current.length > 0
    );
  }

  const pushEditorHistory = useCallback((value: string) => {
    if (!editorHistoryReady.current) {
      editorHistory.current = [value];
      editorRedo.current = [];
      editorHistoryReady.current = true;
      syncEditorHistoryState();
      return;
    }

    const last =
      editorHistory.current[
        editorHistory.current.length - 1
      ];

    if (last === value) {
      return;
    }

    editorHistory.current = [
      ...editorHistory.current.slice(-99),
      value,
    ];

    editorRedo.current = [];
    syncEditorHistoryState();
  }, []);

  const updateEditorContent = useCallback((value: string) => {
    pushEditorHistory(value);
    latestContent.current = value;
    setContent(value);
    setMessage("");
  }, [pushEditorHistory]);

  const undoEditor = useCallback(() => {
    if (editorHistory.current.length <= 1) {
      setMessage("Nothing to undo.");
      return;
    }

    const current = editorHistory.current.pop();

    if (current !== undefined) {
      editorRedo.current.push(current);
    }

    syncEditorHistoryState();

    const previous =
      editorHistory.current[
        editorHistory.current.length - 1
      ] ?? "";

    latestContent.current = previous;
    setContent(previous);
    setMessage("Undo.");
  }, []);

  const redoEditor = useCallback(() => {
    const next = editorRedo.current.pop();

    if (next === undefined) {
      setMessage("Nothing to redo.");
      return;
    }

    editorHistory.current.push(next);
    syncEditorHistoryState();
    latestContent.current = next;
    setContent(next);
    setMessage("Redo.");
  }, []);

  function getEditorElement() {
    return document.querySelector<HTMLTextAreaElement>(
      "textarea[data-work-editor]"
    );
  }

  const pasteIntoEditor = useCallback(async () => {
    const editor = getEditorElement();

    if (!editor) {
      setMessage("Editor not found.");
      return;
    }

    try {
      const clipboardText =
        await navigator.clipboard.readText();

      if (!clipboardText) {
        setMessage("Clipboard is empty.");
        return;
      }

      const start = editor.selectionStart;
      const end = editor.selectionEnd;

      const next =
        content.slice(0, start) +
        clipboardText +
        content.slice(end);

      updateEditorContent(next);

      requestAnimationFrame(() => {
        const currentEditor = getEditorElement();

        if (!currentEditor) {
          return;
        }

        currentEditor.focus();

        const cursor =
          start + clipboardText.length;

        currentEditor.setSelectionRange(
          cursor,
          cursor
        );
      });

      setMessage("Pasted.");
    } catch {
      setMessage(
        "Clipboard access was blocked. Use the device paste option."
      );
    }
  }, [content, updateEditorContent]);

  async function copyFromEditor() {
    const editor = getEditorElement();

    if (!editor) {
      setMessage("Editor not found.");
      return;
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    if (start === end) {
      setMessage("Select some text first.");
      return;
    }

    const selected = content.slice(start, end);

    try {
      await navigator.clipboard.writeText(selected);
      setMessage("Copied.");
    } catch {
      setMessage("Copy was blocked by the browser.");
    }
  }


  const cutFromEditor = useCallback(async () => {
    const editor = getEditorElement();

    if (!editor) {
      setMessage("Editor not found.");
      return;
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    if (start === end) {
      setMessage("Select some text first.");
      return;
    }

    const selected = content.slice(start, end);

    try {
      await navigator.clipboard.writeText(selected);
      updateEditorContent(
        content.slice(0, start) + content.slice(end)
      );

      requestAnimationFrame(() => {
        const currentEditor = getEditorElement();
        currentEditor?.focus();
        currentEditor?.setSelectionRange(start, start);
      });

      setMessage("Cut.");
    } catch {
      setMessage("Cut was blocked by the browser.");
    }
  }, [content, updateEditorContent]);

  const selectAllEditor = useCallback(() => {
    const editor = getEditorElement();

    if (!editor) {
      setMessage("Editor not found.");
      return;
    }

    editor.focus();
    editor.select();
    setMessage("All text selected.");
  }, []);

  const replaceInEditor = useCallback(() => {
    const find = window.prompt("Find text:");

    if (!find) {
      return;
    }

    const replace = window.prompt("Replace with:");

    if (replace === null) {
      return;
    }

    if (!content.includes(find)) {
      setMessage(`"${find}" not found.`);
      return;
    }

    const next = content.split(find).join(replace);
    updateEditorContent(next);
    setMessage("Text replaced.");
  }, [content, updateEditorContent]);

  const findInEditor = useCallback(() => {
    const query = window.prompt("Find text:");

    if (!query) {
      return;
    }

    const editor = getEditorElement();

    if (!editor) {
      setMessage("Editor not found.");
      return;
    }

    const startFrom = editor.selectionEnd || 0;

    let index = content.indexOf(
      query,
      startFrom
    );

    if (index === -1) {
      index = content.indexOf(query);
    }

    if (index === -1) {
      setMessage(`"${query}" not found.`);
      return;
    }

    editor.focus();

    editor.setSelectionRange(
      index,
      index + query.length
    );

    setMessage(`Found "${query}".`);
  }, [content]);

  const getSelectedEditorRange = useCallback(() => {
    const editor = getEditorElement();

    if (!editor) {
      return null;
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    if (start === end) {
      setMessage("Select some text first.");
      return null;
    }

    return {
      start,
      end,
      selected: content.slice(start, end),
    };
  }, [content]);

  const formatSelectedText = useCallback(
    (prefix: string, suffix: string) => {
    const range = getSelectedEditorRange();

    if (!range) {
      return;
    }

    const next =
      content.slice(0, range.start) +
      prefix +
      range.selected +
      suffix +
      content.slice(range.end);

    updateEditorContent(next);

    requestAnimationFrame(() => {
      const editor = getEditorElement();

      if (!editor) {
        return;
      }

      editor.focus();

      const start =
        range.start + prefix.length;

      const end =
        start +
        range.selected.length;

      editor.setSelectionRange(
        start,
        end
      );
    });
  }, [content, updateEditorContent, getSelectedEditorRange]);

  const syncGridHistoryState = useCallback(() => {
    setGridCanUndo(
      gridHistory.current.length > 0
    );
    setGridCanRedo(
      gridRedo.current.length > 0
    );
  }, []);

  function pushGridHistory(previousRows: GridRows) {
    if (!gridHistoryReady.current) {
      return;
    }

    const serialized = serializeGrid(previousRows);

    const last =
      gridHistory.current[
        gridHistory.current.length - 1
      ];

    if (last === serialized) {
      return;
    }

    gridHistory.current = [
      ...gridHistory.current.slice(-99),
      serialized,
    ];

    gridRedo.current = [];
    syncGridHistoryState();
  }

  function beginGridCellEdit(
    row: number,
    column: number
  ) {
    if (
      !gridEditingCell.current ||
      gridEditingCell.current.row !== row ||
      gridEditingCell.current.column !== column
    ) {
      gridEditingCell.current = {
        row,
        column,
        before:
          latestGridRows.current[row]?.[column] ?? "",
      };
    }

    if (gridEditTimer.current) {
      clearTimeout(gridEditTimer.current);
    }

    gridEditTimer.current = setTimeout(() => {
      commitGridCellEdit();
    }, 700);
  }

  const commitGridCellEdit = useCallback(() => {
    if (gridEditTimer.current) {
      clearTimeout(gridEditTimer.current);
      gridEditTimer.current = null;
    }

    const edit = gridEditingCell.current;

    if (!edit) {
      return;
    }

    const after =
      latestGridRows.current[edit.row]?.[
        edit.column
      ] ?? "";

    if (edit.before !== after) {
      const previous = cloneGrid(
        latestGridRows.current
      );

      previous[edit.row][edit.column] =
        edit.before;

      const currentSerialized =
        serializeGrid(latestGridRows.current);

      const previousSerialized =
        serializeGrid(previous);

      if (
        currentSerialized !==
        previousSerialized
      ) {
        gridHistory.current = [
          ...gridHistory.current.slice(-99),
          previousSerialized,
        ];

        gridRedo.current = [];
        syncGridHistoryState();
      }
    }

    gridEditingCell.current = null;
  }, [syncGridHistoryState]);

  function updateGridHeader(
  column: number,
  value: string
) {
  const current =
    latestGridHeaders.current;

  const next =
    normalizeGridHeaders(
      current,
      Math.max(
        current.length,
        column + 1
      )
    );

  next[column] =
    value.trim() ||
    `Column ${column + 1}`;

  latestGridHeaders.current = next;
  setGridHeaders(next);
  setMessage("");
}

function updateGridCell(
    row: number,
    column: number,
    value: string
  ) {
    beginGridCellEdit(row, column);

    const next = cloneGrid(
      latestGridRows.current
    );

    if (!next[row]) {
      return;
    }

    next[row][column] = value;

    latestGridRows.current = next;
    setGridRows(next);
    setMessage("");
  }

  const undoGrid = useCallback(() => {
    commitGridCellEdit();

    const previous =
      gridHistory.current.pop();

    if (!previous) {
      setMessage("Nothing to undo in grid.");
      return;
    }

    const current = serializeGrid(
      latestGridRows.current
    );

    gridRedo.current.push(current);
    syncGridHistoryState();

    const restored =
      normalizeGrid(JSON.parse(previous));

    latestGridRows.current =
      cloneGrid(restored);

    setGridRows(restored);

    setGridFocusedCell(null);

    setMessage("Grid undo.");
  }, [commitGridCellEdit, syncGridHistoryState])

  const redoGrid = useCallback(() => {
    commitGridCellEdit();

    const next = gridRedo.current.pop();

    if (!next) {
      setMessage("Nothing to redo in grid.");
      return;
    }

    const current = serializeGrid(
      latestGridRows.current
    );

    gridHistory.current.push(current);
    syncGridHistoryState();

    const restored =
      normalizeGrid(JSON.parse(next));

    latestGridRows.current =
      cloneGrid(restored);

    setGridRows(restored);

    setGridFocusedCell(null);

    setMessage("Grid redo.");
  }, [commitGridCellEdit, syncGridHistoryState])

  function moveGridCell(
    row: number,
    column: number,
    rowDelta: number,
    columnDelta: number
  ) {
    commitGridCellEdit();

    const rowCount =
      latestGridRows.current.length;

    const columnCount =
      latestGridRows.current[0]?.length ?? 0;

    if (
      rowCount === 0 ||
      columnCount === 0
    ) {
      return;
    }

    let nextRow =
      row + rowDelta;

    let nextColumn =
      column + columnDelta;

    if (nextColumn >= columnCount) {
      nextColumn = 0;
      nextRow += 1;
    }

    if (nextColumn < 0) {
      nextColumn = columnCount - 1;
      nextRow -= 1;
    }

    if (nextRow < 0) {
      nextRow = 0;
    }

    if (nextRow >= rowCount) {
      nextRow = rowCount - 1;
    }

    setSelectedGridRow(nextRow);
    setSelectedGridColumn(nextColumn);

    requestAnimationFrame(() => {
      focusGridCell(
        nextRow,
        nextColumn
      );
    });
  }

  function duplicateSelectedGridRow() {
    if (selectedGridRow === null) {
      setMessage("Select a row first.");
      return;
    }

    commitGridCellEdit();

    const source =
      latestGridRows.current[
        selectedGridRow
      ];

    if (!source) {
      return;
    }

    const next = cloneGrid(
      latestGridRows.current
    );

    next.splice(
      selectedGridRow + 1,
      0,
      [...source]
    );

    pushGridHistory(
      latestGridRows.current
    );

    latestGridRows.current =
      cloneGrid(next);

    setGridRows(next);

    const newRow =
      selectedGridRow + 1;

    setSelectedGridRow(newRow);
    setMessage("Row duplicated.");

    requestAnimationFrame(() => {
      focusGridCell(
        newRow,
        Math.min(
          selectedGridColumn ?? 0,
          next[0].length - 1
        )
      );
    });
  }

  function duplicateSelectedGridColumn() {
    if (selectedGridColumn === null) {
      setMessage("Select a column first.");
      return;
    }

    commitGridCellEdit();

    const column =
      selectedGridColumn;

    const next = latestGridRows.current.map(
      (row) => [
        ...row.slice(0, column + 1),
        row[column] ?? "",
        ...row.slice(column + 1),
      ]
    );

    
  const nextHeaders =
    [...latestGridHeaders.current];
  nextHeaders.splice(
    column + 1,
    0,
    `${latestGridHeaders.current[column] || `Column ${column + 1}`} Copy`
  );

pushGridHistory(
      latestGridRows.current
    );

    latestGridRows.current =
      cloneGrid(next);

    setGridRows(next);
  latestGridHeaders.current =
    nextHeaders;
  setGridHeaders(nextHeaders);

    const newColumn = column + 1;

    setSelectedGridColumn(
      newColumn
    );

    setMessage("Column duplicated.");

    requestAnimationFrame(() => {
      focusGridCell(
        Math.min(
          selectedGridRow ?? 0,
          next.length - 1
        ),
        newColumn
      );
    });
  }

  function deleteSelectedGridRow() {
    if (selectedGridRow === null) {
      setMessage("Select a row first.");
      return;
    }

    if (
      latestGridRows.current.length <= 1
    ) {
      setMessage(
        "At least one row must remain."
      );
      return;
    }

    commitGridCellEdit();

    pushGridHistory(
      latestGridRows.current
    );

    const next =
      latestGridRows.current.filter(
        (_, index) =>
          index !== selectedGridRow
      );

    latestGridRows.current =
      cloneGrid(next);

    setGridRows(next);

    setSelectedGridRow(
      Math.min(
        selectedGridRow,
        next.length - 1
      )
    );

    setMessage("Selected row deleted.");
  }

  function deleteSelectedGridColumn() {
    if (selectedGridColumn === null) {
      setMessage("Select a column first.");
      return;
    }

    const columnCount =
      latestGridRows.current[0]?.length ??
      0;

    if (columnCount <= 1) {
      setMessage(
        "At least one column must remain."
      );
      return;
    }

    commitGridCellEdit();

    pushGridHistory(
      latestGridRows.current
    );

    const next =
      latestGridRows.current.map(
        (row) =>
          row.filter(
            (_, index) =>
              index !== selectedGridColumn
          )
      );

    latestGridRows.current =
      cloneGrid(next);

    setGridRows(next);

    setSelectedGridColumn(
      Math.min(
        selectedGridColumn,
        next[0].length - 1
      )
    );

    setMessage("Selected column deleted.");
  }


  function sortGridByColumn(column: number, direction: "asc" | "desc") {
    commitGridCellEdit();

    const current = cloneGrid(latestGridRows.current);

    if (current.length <= 1) {
      setMessage("Not enough rows to sort.");
      return;
    }

    pushGridHistory(latestGridRows.current);

    const sorted = [...current].sort((a, b) => {
      const av = (a[column] ?? "").toLowerCase();
      const bv = (b[column] ?? "").toLowerCase();

      const numericA = Number(av);
      const numericB = Number(bv);

      let result: number;

      if (
        av !== "" &&
        bv !== "" &&
        Number.isFinite(numericA) &&
        Number.isFinite(numericB)
      ) {
        result = numericA - numericB;
      } else {
        result = av.localeCompare(bv, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }

      return direction === "asc" ? result : -result;
    });

    latestGridRows.current = cloneGrid(sorted);
    setGridRows(sorted);
    setGridSortColumn(column);
    setGridSortDirection(direction);
    setMessage(
      `Column ${column + 1} sorted ${direction === "asc" ? "A→Z" : "Z→A"}.`
    );
  }

  function filterGrid() {
    const query = window.prompt("Filter rows by text:");

    if (query === null) {
      return;
    }

    setGridFilterText(query.trim());
    setMessage(
      query.trim()
        ? `Showing rows containing "${query.trim()}".`
        : "Grid filter cleared."
    );
  }

  function clearGridFilter() {
    setGridFilterText("");
    setMessage("Grid filter cleared.");
  }

  function fillSelectedColumn() {
    if (selectedGridColumn === null) {
      setMessage("Select a column first.");
      return;
    }

    const firstValue =
      latestGridRows.current[0]?.[selectedGridColumn] ?? "";

    if (!firstValue) {
      setMessage("The first cell in this column is empty.");
      return;
    }

    commitGridCellEdit();
    pushGridHistory(latestGridRows.current);

    const next = latestGridRows.current.map((row) => {
      const copy = [...row];
      copy[selectedGridColumn] = firstValue;
      return copy;
    });

    latestGridRows.current = cloneGrid(next);
    setGridRows(next);
    setMessage(`Column ${selectedGridColumn + 1} filled.`);
  }

  function clearSelectedColumn() {
    if (selectedGridColumn === null) {
      setMessage("Select a column first.");
      return;
    }

    commitGridCellEdit();
    pushGridHistory(latestGridRows.current);

    const next = latestGridRows.current.map((row) => {
      const copy = [...row];
      copy[selectedGridColumn] = "";
      return copy;
    });

    latestGridRows.current = cloneGrid(next);
    setGridRows(next);
    setMessage(`Column ${selectedGridColumn + 1} cleared.`);
  }


  function insertGridRowAbove() {
    const index = selectedGridRow ?? 0;
    commitGridCellEdit();
    pushGridHistory(latestGridRows.current);

    const width = latestGridRows.current[0]?.length || 3;
    const next = [...latestGridRows.current];
    next.splice(index, 0, Array(width).fill(""));

    latestGridRows.current = cloneGrid(next);
    setGridRows(next);
    setSelectedGridRow(index);
    setSelectedGridColumn(0);
    setMessage(`Row ${index + 1} inserted above.`);
  }

  function insertGridRowBelow() {
    const index = selectedGridRow ?? latestGridRows.current.length - 1;
    commitGridCellEdit();
    pushGridHistory(latestGridRows.current);

    const width = latestGridRows.current[0]?.length || 3;
    const next = [...latestGridRows.current];
    next.splice(index + 1, 0, Array(width).fill(""));

    latestGridRows.current = cloneGrid(next);
    setGridRows(next);
    setSelectedGridRow(index + 1);
    setSelectedGridColumn(0);
    setMessage(`Row ${index + 2} inserted below.`);
  }

  function insertGridColumnLeft() {
    const index = selectedGridColumn ?? 0;
    commitGridCellEdit();
    pushGridHistory(latestGridRows.current);

    const next = latestGridRows.current.map((row) => {
      const copy = [...row];
      copy.splice(index, 0, "");
      return copy;
    });

    latestGridRows.current = cloneGrid(next);
    setGridRows(next);
    setSelectedGridColumn(index);
    setMessage(`Column ${index + 1} inserted left.`);
  }

  function insertGridColumnRight() {
    const index = selectedGridColumn ?? ((latestGridRows.current[0]?.length ?? 1) - 1);
    commitGridCellEdit();
    pushGridHistory(latestGridRows.current);

    const next = latestGridRows.current.map((row) => {
      const copy = [...row];
      copy.splice(index + 1, 0, "");
      return copy;
    });

    latestGridRows.current = cloneGrid(next);
    setGridRows(next);
    setSelectedGridColumn(index + 1);
    setMessage(`Column ${index + 2} inserted right.`);
  }

  function fillSelectedColumnDown() {
    const column = selectedGridColumn;

    if (column === null) {
      setMessage("Select a column first.");
      return;
    }

    const source = latestGridRows.current[0]?.[column] ?? "";

    if (!source) {
      setMessage("The first cell is empty.");
      return;
    }

    commitGridCellEdit();
    pushGridHistory(latestGridRows.current);

    const next = latestGridRows.current.map((row) => {
      const copy = [...row];
      copy[column] = source;
      return copy;
    });

    latestGridRows.current = cloneGrid(next);
    setGridRows(next);
    setMessage(`Column ${column + 1} filled down.`);
  }

  function fillSelectedRowRight() {
    const rowIndex = selectedGridRow;

    if (rowIndex === null) {
      setMessage("Select a row first.");
      return;
    }

    const source = latestGridRows.current[rowIndex]?.[0] ?? "";

    if (!source) {
      setMessage("The first cell is empty.");
      return;
    }

    commitGridCellEdit();
    pushGridHistory(latestGridRows.current);

    const next = cloneGrid(latestGridRows.current);
    next[rowIndex] = next[rowIndex].map(() => source);

    latestGridRows.current = cloneGrid(next);
    setGridRows(next);
    setMessage(`Row ${rowIndex + 1} filled right.`);
  }

  function clearGrid() {
    commitGridCellEdit();

    const current =
      latestGridRows.current;

    const cleared =
      current.map((row) =>
        row.map(() => "")
      );

    if (
      serializeGrid(current) ===
      serializeGrid(cleared)
    ) {
      setMessage("Grid is already empty.");
      return;
    }

    pushGridHistory(current);

    latestGridRows.current =
      cloneGrid(cleared);

    setGridRows(cleared);

    setSelectedGridRow(null);
    setSelectedGridColumn(null);
    setGridFocusedCell(null);

    setMessage("Grid cleared.");
  }

  const saveWorkFile = useCallback(
    async (
      status: WorkFileStatus,
      logHistory = true
    ) => {
      commitGridCellEdit();

      setSaving(true);
      setMessage("Saving...");

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setMessage("Please sign in again.");
          return;
        }

        const rows =
          latestGridRows.current;

        const editorContent =
          latestContent.current;

        const response = await fetch(
          `/api/work-files/${id}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
              Authorization:
                `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              content:
                serializeWorkFileContent(
                  editorContent,
                  rows,
                  latestGridHeaders.current
                ),
              status,
              logHistory,
            }),
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          setMessage(
            data?.error ||
              "Unable to save work file."
          );
          return;
        }

        setWorkFile(data.workFile);
      const apiSource = data.workFile?.sourceFile;

      if (apiSource) {
        setSourceFile((previous) => ({
          id: String(apiSource.id),
          file_name: String(apiSource.file_name),
          category: String(apiSource.category || ""),
          mime_type: apiSource.mime_type
            ? String(apiSource.mime_type)
            : null,
          preview_url:
            apiSource.preview_url ||
            previous?.preview_url ||
            null,
        }));
      }


        setMessage(
          status === "Completed"
            ? "Work completed successfully."
            : "Saved successfully."
        );
      } catch {
        setMessage(
          "Unable to save work file."
        );
      } finally {
        setSaving(false);
      }
    },
    [id, commitGridCellEdit]
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadPdfPreview() {
      setSourcePdfPreviewUrl(null);

      if (
        !sourceFile?.id ||
        sourceFile.mime_type !== "application/pdf"
      ) {
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session || cancelled) {
          return;
        }

        const response = await fetch(
          `/api/file-access/preview?fileId=${encodeURIComponent(
            sourceFile.id
          )}`,
          {
            method: "GET",
            credentials: "include",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );

        if (!response.ok) {
          return;
        }

        const blob = await response.blob();

        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setSourcePdfPreviewUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setSourcePdfPreviewUrl(null);
        }
      }
    }

    void loadPdfPreview();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [sourceFile?.id, sourceFile?.mime_type]);

  const requestWorkFileDelete = useCallback(
    async () => {
      if (!workFile?.id || deleteLoading) return;

      setDeleteLoading(true);
      setDeleteError("");

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setDeleteError("Please sign in again.");
          return;
        }

        const response = await fetch(
          "/api/file-delete/request",
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              fileId: workFile.id,
              resourceType: "work_file",
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          setDeleteError(
            data?.error || "Unable to request Delete OTP."
          );
          return;
        }

        setDeleteStep("otp");
        setDeleteOtp("");
        setDeleteError("");
      } catch {
        setDeleteError("Unable to request Delete OTP.");
      } finally {
        setDeleteLoading(false);
      }
    },
    [workFile, deleteLoading]
  );

  const verifyWorkFileDelete = useCallback(
    async () => {
      if (
        !workFile?.id ||
        deleteLoading ||
        deleteOtp.length !== 6
      ) {
        return;
      }

      setDeleteLoading(true);
      setDeleteError("");

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setDeleteError("Please sign in again.");
          return;
        }

        const response = await fetch(
          "/api/file-delete/verify",
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              fileId: workFile.id,
              resourceType: "work_file",
              otp: deleteOtp,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          setDeleteError(
            data?.error || "Unable to delete Work File."
          );
          return;
        }

        setDeleteOpen(false);
        setDeleteOtp("");
        setDeleteError("");
        setMessage("Work File deleted successfully.");

        router.push(
          `/files?category=${encodeURIComponent(workFile.category)}`
        );
      } catch {
        setDeleteError("Unable to delete Work File.");
      } finally {
        setDeleteLoading(false);
      }
    },
    [workFile, deleteLoading, deleteOtp, router]
  );

  const closeDeleteDialog = useCallback(() => {
    if (deleteLoading) return;

    setDeleteOpen(false);
    setDeleteStep("confirm");
    setDeleteOtp("");
    setDeleteError("");
  }, [deleteLoading]);

  const loadWorkFile = useCallback(
    async () => {
      setLoading(true);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setMessage(
            "Please sign in again."
          );
          return;
        }

        const response = await fetch(
          `/api/work-files/${id}`,
          {
            credentials: "include",
            headers: {
              Authorization:
                `Bearer ${session.access_token}`,
            },
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          setMessage(
            data?.error ||
              "Unable to load work file."
          );
          return;
        }

        const loadedFile =
          data.workFile as WorkFile;

        setRequiredWorkUnits(null);

        try {
          const completionResponse = await fetch(
            `/api/work-files/${id}/completion-check`,
            {
              method: "GET",
              credentials: "include",
              headers: {
                Authorization:
                  `Bearer ${session.access_token}`,
              },
            }
          );

          const completionData =
            await completionResponse.json();

          console.log(
            "[ULTIMA COMPLETION DEBUG]",
            {
              workFileId: id,
              status: completionResponse.status,
              ok: completionResponse.ok,
              completionData,
            }
          );

          if (
            completionResponse.ok &&
            Number.isFinite(
              Number(
                completionData?.scope?.workUnits
              )
            ) &&
            Number(
              completionData.scope.workUnits
            ) > 0
          ) {
            setRequiredWorkUnits(
              Number(
                completionData.scope.workUnits
              )
            );
          }
        } catch {
          setRequiredWorkUnits(null);
        }

        const parsed =
          parseWorkFileContent(
            loadedFile.content || ""
          );

        const normalizedRows =
          normalizeGrid(
            parsed.gridRows
          );

        setWorkFile(
          loadedFile
        );

        const loadedSource = data.workFile?.sourceFile;

        if (loadedSource) {
          setSourceFile({
            id: String(loadedSource.id),
            file_name: String(loadedSource.file_name),
            category: String(loadedSource.category || ""),
            mime_type: loadedSource.mime_type
              ? String(loadedSource.mime_type)
              : null,
            preview_url: loadedSource.preview_url
              ? String(loadedSource.preview_url)
              : null,
          });
        } else if (sourceFileId) {
          try {
            const sourceResponse = await fetch(
              `/api/file-access/preview?fileId=${encodeURIComponent(sourceFileId)}`,
              {
                method: "GET",
                credentials: "include",
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                },
              }
            );

            if (sourceResponse.ok) {
              setSourceFile({
                id: sourceFileId,
                file_name: String(
                  sessionStorage.getItem("ultima_work_source_file")
                    ? JSON.parse(
                        sessionStorage.getItem("ultima_work_source_file") || "{}"
                      )?.file_name || "Original uploaded file"
                    : "Original uploaded file"
                ),
                category: String(
                  sessionStorage.getItem("ultima_work_source_file")
                    ? JSON.parse(
                        sessionStorage.getItem("ultima_work_source_file") || "{}"
                      )?.category || loadedFile.category || ""
                    : loadedFile.category || ""
                ),
                mime_type:
                  sessionStorage.getItem("ultima_work_source_file")
                    ? JSON.parse(
                        sessionStorage.getItem("ultima_work_source_file") || "{}"
                      )?.mime_type || null
                    : null,
                preview_url: null,
              });
            } else {
              setSourceFile(null);
            }
          } catch {
            setSourceFile(null);
          }
        } else {
          setSourceFile(null);
        }

        latestContent.current =
          parsed.editorContent;

        setContent(
          parsed.editorContent
        );

        latestGridRows.current =
          cloneGrid(normalizedRows);

        setGridRows(
          normalizedRows
        );

        const normalizedHeaders =
          normalizeGridHeaders(
            parsed.gridHeaders,
            normalizedRows[0]?.length || 1
          );

        latestGridHeaders.current =
          cloneGridHeaders(normalizedHeaders);

        setGridHeaders(
          normalizedHeaders
        );

        editorHistory.current = [
          parsed.editorContent,
        ];

        editorRedo.current = [];

        editorHistoryReady.current =
          true;

        syncEditorHistoryState();

        gridHistory.current = [];

        gridRedo.current = [];

        gridHistoryReady.current =
          true;

        syncGridHistoryState();

        setSelectedGridRow(null);
        setSelectedGridColumn(null);
        setGridFocusedCell(null);

      } catch {
        setMessage(
          "Unable to load work file."
        );
      } finally {
        setLoading(false);
      }
    },
    [id, syncGridHistoryState]
  );

  const completedWorkUnits =
    gridRows.filter(
      (row) =>
        Array.isArray(row) &&
        row.some(
          (cell) =>
            String(cell ?? "").trim().length > 0
        )
    ).length;

  const workCompletionReady =
    requiredWorkUnits !== null &&
    completedWorkUnits >= requiredWorkUnits;

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) {
        return;
      }

      if (!session) {
        router.replace("/");
        return;
      }

      setAuthChecking(false);
    }

    void checkAuth();

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (!session) {
            router.replace("/");
          }
        }
      );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadWorkFile();
    }, 0);

    return () => {
      clearTimeout(timer);

      if (gridEditTimer.current) {
        clearTimeout(
          gridEditTimer.current
        );
      }
    };
  }, [loadWorkFile]);

  useEffect(() => {
    function handleEditorShortcuts(
      event: KeyboardEvent
    ) {
      const target =
        event.target as HTMLElement | null;

      if (
        !target?.matches?.(
          "textarea[data-work-editor]"
        )
      ) {
        return;
      }

      const modifier =
        event.ctrlKey ||
        event.metaKey;

      if (!modifier) {
        return;
      }

      const key =
        event.key.toLowerCase();

      if (
        key === "z" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        undoEditor();
        return;
      }

      if (
        (key === "z" &&
          event.shiftKey) ||
        key === "y"
      ) {
        event.preventDefault();
        redoEditor();
        return;
      }

      if (key === "f") {
        event.preventDefault();
        findInEditor();
        return;
      }

      if (key === "x") {
        event.preventDefault();
        void cutFromEditor();
        return;
      }

      if (key === "c") {
        event.preventDefault();
        void copyFromEditor();
        return;
      }

      if (key === "v") {
        event.preventDefault();
        void pasteIntoEditor();
        return;
      }

      if (key === "a") {
        event.preventDefault();
        selectAllEditor();
        return;
      }

      if (key === "h") {
        event.preventDefault();
        replaceInEditor();
        return;
      }

      if (key === "b") {
        event.preventDefault();
        formatSelectedText(
          "**",
          "**"
        );
        return;
      }

      if (key === "i") {
        event.preventDefault();
        formatSelectedText(
          "_",
          "_"
        );
      }
    }

    document.addEventListener(
      "keydown",
      handleEditorShortcuts
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleEditorShortcuts
      );
    };
  }, [
    content,
    findInEditor,
    formatSelectedText,
    pasteIntoEditor,
    cutFromEditor,
    selectAllEditor,
    replaceInEditor,
    redoEditor,
    undoEditor,
  ]);

  useEffect(() => {
    function handleGridShortcuts(
      event: KeyboardEvent
    ) {
      const target =
        event.target as HTMLElement | null;

      if (
        !target?.closest?.(
          "[data-work-grid]"
        )
      ) {
        return;
      }

      const modifier =
        event.ctrlKey ||
        event.metaKey;

      if (!modifier) {
        return;
      }

      const key =
        event.key.toLowerCase();

      if (
        key === "z" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        undoGrid();
        return;
      }

      if (
        (key === "z" &&
          event.shiftKey) ||
        key === "y"
      ) {
        event.preventDefault();
        redoGrid();
      }
    }

    document.addEventListener(
      "keydown",
      handleGridShortcuts
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleGridShortcuts
      );
    };
  }, [
    redoGrid,
    undoGrid,
  ]);


  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        Loading work file...
      </main>
    );
  }

  if (!workFile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <div className="text-lg font-semibold">
            Work file unavailable
          </div>

          <Link
            href="/files"
            className="mt-4 inline-block text-cyan-400"
          >
            ← Back to Files
          </Link>
        </div>
      </main>
    );
  }

  if (authChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-sm text-slate-400">
          Verifying secure session...
        </div>
      </main>
    );
  }

  const isCompleted =
    workFile.status ===
    "Completed";

  const isReadOnly =
    isCompleted || isViewMode;

  const visibleGridRows: GridRows = gridFilterText
    ? gridRows.filter((row: string[]) =>
        row.some((cell: string) =>
          cell.toLowerCase().includes(gridFilterText.toLowerCase())
        )
      )
    : gridRows;

  const columnCount =
    gridRows[0]?.length ?? 0;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <InactivityAutoLock />
      <ScreenLightLocker />
      <header className="border-b border-white/10 bg-slate-900/80 px-4 py-4 md:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link
              href={`/files?category=${encodeURIComponent(
                workFile.category
              )}`}
              className="text-xs text-cyan-400"
            >
              ← {workFile.category}
            </Link>

            <h1 className="mt-1 truncate text-xl font-bold">
              {workFile.file_name}
            </h1>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>
                {workFile.category}
              </span>

              <span>·</span>

              <span>
                {workFile.status}
              </span>

              {isCompleted && (
                <>
                  <span>·</span>
                  <span className="text-emerald-400">
                    Read-only
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            {isViewMode && !isCompleted && (
              <button
                type="button"
                onClick={() =>
                  router.push(`/work-files/${id}`)
                }
                className="rounded-xl bg-blue-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-blue-300"
              >
                Edit
              </button>
            )}

            <button
              type="button"
              disabled={
                saving ||
                isReadOnly ||
                !workCompletionReady
              }
              onClick={() =>
                void saveWorkFile(
                  "Saved"
                )
              }
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
            >
              {saving
                ? "Saving..."
                : "Save"}
            </button>

            <button
              type="button"
              disabled={
                saving ||
                isReadOnly ||
                !workCompletionReady
              }
              onClick={() =>
                void saveWorkFile(
                  "Completed"
                )
              }
              className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              Complete
            </button>

            <button
              type="button"
              disabled={saving || deleteLoading}
              onClick={() => {
                setDeleteStep("confirm");
                setDeleteOtp("");
                setDeleteError("");
                setDeleteOpen(true);
              }}
              className="rounded-xl border border-red-400/40 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-400/10 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      </header>

      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-work-file-title"
            className="w-full max-w-md rounded-2xl border border-red-400/20 bg-slate-900 p-6 shadow-2xl"
          >
            {deleteStep === "confirm" ? (
              <>
                <h2
                  id="delete-work-file-title"
                  className="text-lg font-bold text-white"
                >
                  Delete Work File?
                </h2>

                <p className="mt-3 text-sm leading-6 text-slate-300">
                  This will permanently delete{" "}
                  <span className="font-semibold text-white">
                    {workFile.file_name}
                  </span>
                  . A Delete OTP will be sent to your registered email.
                </p>

                {deleteError && (
                  <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-300">
                    {deleteError}
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={deleteLoading}
                    onClick={closeDeleteDialog}
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={deleteLoading}
                    onClick={() => void requestWorkFileDelete()}
                    className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 disabled:opacity-50"
                  >
                    {deleteLoading
                      ? "Sending OTP..."
                      : "Send Delete OTP"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2
                  id="delete-work-file-title"
                  className="text-lg font-bold text-white"
                >
                  Enter Delete OTP
                </h2>

                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Enter the 6-digit OTP sent to your registered email.
                  The Delete OTP expires in 120 seconds.
                </p>

                <input
                  value={deleteOtp}
                  onChange={(event) =>
                    setDeleteOtp(
                      event.target.value
                        .replace(/\D/g, "")
                        .slice(0, 6)
                    )
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  placeholder="000000"
                  className="mt-5 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-center text-xl tracking-[0.4em] text-white outline-none focus:border-cyan-400"
                />

                {deleteError && (
                  <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-300">
                    {deleteError}
                  </div>
                )}

                <div className="mt-6 flex justify-between gap-2">
                  <button
                    type="button"
                    disabled={deleteLoading}
                    onClick={() => {
                      setDeleteStep("confirm");
                      setDeleteOtp("");
                      setDeleteError("");
                    }}
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
                  >
                    Back
                  </button>

                  <button
                    type="button"
                    disabled={
                      deleteLoading ||
                      deleteOtp.length !== 6
                    }
                    onClick={() => void verifyWorkFileDelete()}
                    className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 disabled:opacity-50"
                  >
                    {deleteLoading
                      ? "Deleting..."
                      : "Verify & Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl p-4 md:p-8">

        {sourceFile && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-cyan-400/20 bg-slate-900/80">

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">

              <div>
                <div className="text-sm font-semibold text-cyan-300">
                  Original Uploaded File — Reference
                </div>

                <div className="mt-1 text-xs text-slate-400">
                  {sourceFile.file_name}
                  {sourceFile.category
                    ? ` · ${sourceFile.category}`
                    : ""}
                </div>
              </div>

              {sourceFile.preview_url && (
                <a
                  href={
                    sourceFile.mime_type === "application/pdf" &&
                    sourcePdfPreviewUrl
                      ? sourcePdfPreviewUrl
                      : sourceFile.preview_url
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-400/20"
                >
                  Open Original
                </a>
              )}

            </div>

            <div className="bg-slate-950/70 p-3">

              {sourceFile.preview_url ? (

                sourceFile.mime_type?.startsWith("image/") ? (

                  <div className="max-h-[520px] overflow-auto rounded-xl border border-white/10 bg-black/20 p-2">
                    <img
                      src={sourceFile.preview_url}
                      alt={sourceFile.file_name}
                      className="mx-auto max-h-[500px] max-w-full object-contain"
                    />
                  </div>

                ) : sourceFile.mime_type === "application/pdf" ? (

                  <PdfJsPreview
                    pdfUrl={
                      sourcePdfPreviewUrl ||
                      sourceFile.preview_url
                    }
                    fileName={sourceFile.file_name}
                  />

                ) : (

                  <div className="rounded-xl border border-white/10 bg-slate-900 p-5 text-sm text-slate-300">
                    Original file is available as a reference.

                    <div className="mt-3">
                      <a
                        href={sourceFile.preview_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-300 underline underline-offset-4"
                      >
                        Open the original file
                      </a>
                    </div>
                  </div>

                )

              ) : (

                <div className="rounded-xl border border-white/10 bg-slate-900 p-5 text-sm text-slate-400">
                  Original file preview is not available here.
                </div>

              )}

            </div>
          </section>
        )}


        <section className="mb-5 overflow-hidden rounded-2xl border border-emerald-400/20 bg-slate-900/80">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-base font-semibold text-emerald-300">
              Work Dashboard
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Your working area — edit and process the work file below.
              {sourceFile
                ? " The original uploaded file above is reference-only and remains unchanged."
                : ""}
            </div>
          </div>
        </section>

        <div className="mb-4 rounded-2xl border border-white/10 bg-slate-900/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={undoEditor}
              disabled={
                isReadOnly ||
                !editorCanUndo
              }
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
            >
              Undo
            </button>

            <button
              type="button"
              onClick={redoEditor}
              disabled={
                isReadOnly ||
                !editorCanRedo
              }
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
            >
              Redo
            </button>

            <button
              type="button"
              onClick={findInEditor}
              disabled={isReadOnly}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
            >
              Find
            </button>

            <button
              type="button"
              onClick={() =>
                void cutFromEditor()
              }
              disabled={isReadOnly}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
            >
              Cut
            </button>

            <button
              type="button"
              onClick={() =>
                void copyFromEditor()
              }
              disabled={isReadOnly}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
            >
              Copy
            </button>

            <button
              type="button"
              onClick={() =>
                void pasteIntoEditor()
              }
              disabled={isReadOnly}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
            >
              Paste
            </button>

            <button
              type="button"
              onClick={selectAllEditor}
              disabled={isReadOnly}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
            >
              Select All
            </button>

            <button
              type="button"
              onClick={replaceInEditor}
              disabled={isReadOnly}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
            >
              Replace
            </button>

            <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />

            <button
              type="button"
              onClick={() =>
                formatSelectedText(
                  "**",
                  "**"
                )
              }
              disabled={isReadOnly}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10 disabled:opacity-40"
            >
              B
            </button>

            <button
              type="button"
              onClick={() =>
                formatSelectedText(
                  "_",
                  "_"
                )
              }
              disabled={isReadOnly}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm italic hover:bg-white/10 disabled:opacity-40"
            >
              I
            </button>

            <button
              type="button"
              onClick={() =>
                formatSelectedText(
                  "__",
                  "__"
                )
              }
              disabled={isReadOnly}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm underline hover:bg-white/10 disabled:opacity-40"
            >
              U
            </button>

            <button
              type="button"
              onClick={() => {
                updateEditorContent("");
                setMessage(
                  "Editor cleared."
                );
              }}
              disabled={isReadOnly}
              className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-sm text-red-300 hover:bg-red-400/10 disabled:opacity-40"
            >
              Clear
            </button>

            <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />

            <span className="rounded-lg bg-cyan-400/10 px-3 py-2 text-xs text-cyan-300">
              Manual Save · Stable Data Entry Editor
            </span>
          </div>
        </div>


        {message && (
          <div className="mb-5 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
            {message}
          </div>
        )}

        <div className="mb-4 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">
                Workboard Workspace
              </div>
              <div className="mt-1 text-xs text-slate-500">
                One Workboard with both Docs and Sheets for this category.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setWorkspaceMode("docs")}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  workspaceMode === "docs"
                    ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-300"
                    : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                Docs Workspace
              </button>

              <button
                type="button"
                onClick={() => setWorkspaceMode("sheets")}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  workspaceMode === "sheets"
                    ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-300"
                    : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                Sheets Workspace
              </button>
            </div>
          </div>
        </div>


        {workspaceMode === "docs" && (
        <div className="mb-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-sm font-semibold text-white">
              Work Editor
            </div>

            <div className="mt-1 text-xs text-slate-500">
              Enter notes, instructions, or work data here.
            </div>
          </div>

          <div className="p-3">
            <textarea
              data-work-editor
              value={content}
              readOnly={isReadOnly}
              dir="ltr"
              onChange={(event) =>
                updateEditorContent(
                  event.target.value
                )
              }
              spellCheck
              placeholder={
                isCompleted
                  ? "This work file is completed and read-only."
                  : "Start entering your work here..."
              }
              className="min-h-[260px] w-full resize-y rounded-xl border border-white/10 bg-slate-950/80 p-4 text-left text-sm leading-6 text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-400/40 focus:ring-1 focus:ring-cyan-400/20 disabled:opacity-60"
              style={{
                direction: "ltr",
                unicodeBidi: "plaintext",
                textAlign: "left",
              }}
            />

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {content.length} characters
              </span>

              <span>
                Ctrl/Cmd + Z: Undo · Ctrl/Cmd + Shift + Z: Redo
              </span>
            </div>
          </div>
        </div>

        )}

        {workspaceMode === "sheets" && (
        <div
          data-work-grid
          className="mb-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-3">
            <div>
              <div className="text-sm font-semibold text-white">
                Data Entry Grid
              </div>

              {gridFilterText && (
                <div className="mt-1 text-xs text-cyan-300">
                  Filter: &quot;{gridFilterText}&quot;
                </div>
              )}

              <div className="text-xs text-slate-500">
                {isCompleted
                  ? "Completed work file — read-only"
                  : "Editable rows and columns"}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => {
                  commitGridCellEdit();

                  const next =
                    cloneGrid(
                      latestGridRows.current
                    );

                  next.push(
                    Array(
                      next[0]?.length || 3
                    ).fill("")
                  );

                  pushGridHistory(
                    latestGridRows.current
                  );

                  latestGridRows.current =
                    cloneGrid(next);

                  setGridRows(next);
                  setMessage("");
                }}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                + Add Row
              </button>

              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => {
                  commitGridCellEdit();

                  const next =
                    latestGridRows.current.map(
                      (row) => [
                        ...row,
                        "",
                      ]
                    );

                  pushGridHistory(
                    latestGridRows.current
                  );

                  latestGridRows.current =
                    cloneGrid(next);

                  setGridRows(next);
                  setMessage("");
                }}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                + Add Column
              </button>

              <button
                type="button"
                onClick={
                  duplicateSelectedGridRow
                }
                disabled={
                  isReadOnly ||
                  selectedGridRow === null
                }
                className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-400/10 disabled:opacity-40"
              >
                Duplicate Row
              </button>

              <button
                type="button"
                onClick={
                  duplicateSelectedGridColumn
                }
                disabled={
                  isReadOnly ||
                  selectedGridColumn === null
                }
                className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-400/10 disabled:opacity-40"
              >
                Duplicate Column
              </button>

              <button
                type="button"
                onClick={
                  deleteSelectedGridRow
                }
                disabled={
                  isReadOnly ||
                  selectedGridRow === null ||
                  gridRows.length <= 1
                }
                className="rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-40"
              >
                Delete Row
              </button>

              <button
                type="button"
                onClick={
                  deleteSelectedGridColumn
                }
                disabled={
                  isReadOnly ||
                  selectedGridColumn === null ||
                  columnCount <= 1
                }
                className="rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-40"
              >
                Delete Column
              </button>

              <button
                type="button"
                onClick={undoGrid}
                disabled={
                  isReadOnly ||
                  !gridCanUndo
                }
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Grid Undo
              </button>

              <button
                type="button"
                onClick={redoGrid}
                disabled={
                  isReadOnly ||
                  !gridCanRedo
                }
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Grid Redo
              </button>

              <button
                type="button"
                onClick={() => {
                  if (selectedGridColumn !== null) {
                    sortGridByColumn(
                      selectedGridColumn,
                      "asc"
                    );
                  } else {
                    setMessage("Select a column first.");
                  }
                }}
                disabled={isReadOnly || selectedGridColumn === null}
                className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-400/10 disabled:opacity-40"
              >
                Sort A→Z
              </button>

              <button
                type="button"
                onClick={() => {
                  if (selectedGridColumn !== null) {
                    sortGridByColumn(
                      selectedGridColumn,
                      "desc"
                    );
                  } else {
                    setMessage("Select a column first.");
                  }
                }}
                disabled={isReadOnly || selectedGridColumn === null}
                className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-400/10 disabled:opacity-40"
              >
                Sort Z→A
              </button>

              <button
                type="button"
                onClick={filterGrid}
                disabled={isReadOnly}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Filter
              </button>

              <button
                type="button"
                onClick={clearGridFilter}
                disabled={isReadOnly || !gridFilterText}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Clear Filter
              </button>

              <button
                type="button"
                onClick={fillSelectedColumn}
                disabled={isReadOnly || selectedGridColumn === null}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Fill Column
              </button>

              <button
                type="button"
                onClick={clearSelectedColumn}
                disabled={isReadOnly || selectedGridColumn === null}
                className="rounded-lg border border-amber-400/20 px-3 py-2 text-xs text-amber-300 hover:bg-amber-400/10 disabled:opacity-40"
              >
                Clear Column
              </button>

              <button
                type="button"
                onClick={insertGridRowAbove}
                disabled={isReadOnly}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Insert Row ↑
              </button>

              <button
                type="button"
                onClick={insertGridRowBelow}
                disabled={isReadOnly}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Insert Row ↓
              </button>

              <button
                type="button"
                onClick={insertGridColumnLeft}
                disabled={isReadOnly}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Insert Col ←
              </button>

              <button
                type="button"
                onClick={insertGridColumnRight}
                disabled={isReadOnly}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Insert Col →
              </button>

              <button
                type="button"
                onClick={fillSelectedColumnDown}
                disabled={isReadOnly || selectedGridColumn === null}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Fill Down
              </button>

              <button
                type="button"
                onClick={fillSelectedRowRight}
                disabled={isReadOnly || selectedGridRow === null}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Fill Right
              </button>

              <button
                type="button"
                onClick={clearGrid}
                disabled={isReadOnly}
                className="rounded-lg border border-amber-400/20 px-3 py-2 text-xs text-amber-300 hover:bg-amber-400/10 disabled:opacity-40"
              >
                Clear Grid
              </button>
            </div>
          </div>

          <div className="overflow-x-auto p-3">
            
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border border-white/10 bg-slate-900 px-3 py-2 text-left text-xs text-slate-500">
                    #
                  </th>

                  {gridRows[0]?.map(
                    (_, columnIndex) => (
                      <th
                        key={columnIndex}
                        className={`min-w-[180px] cursor-pointer border border-white/10 px-3 py-2 text-left text-xs ${
                          selectedGridColumn ===
                          columnIndex
                            ? "bg-cyan-400/20 text-cyan-300"
                            : "bg-white/[0.04] text-slate-400"
                        }`}
                        onClick={() => {
                          setSelectedGridColumn(
                            columnIndex
                          );

                          setMessage(
                            `Column ${
                              columnIndex + 1
                            } selected.`
                          );
                        }}
                      >
                        Column{" "}
                        {columnIndex + 1}
                      </th>
                    )
                  )}
                </tr>
              </thead>

              <tbody>
                {visibleGridRows.map(
                  (row, rowIndex) => (
                    <tr key={rowIndex}>
                      <td
                        onClick={() => {
                          setSelectedGridRow(
                            rowIndex
                          );

                          setMessage(
                            `Row ${
                              rowIndex + 1
                            } selected.`
                          );
                        }}
                        className={`sticky left-0 z-10 cursor-pointer border border-white/10 px-3 py-2 text-xs ${
                          selectedGridRow ===
                          rowIndex
                            ? "bg-cyan-400/20 text-cyan-300"
                            : "bg-slate-900 text-slate-600"
                        }`}
                      >
                        {rowIndex + 1}
                      </td>

                      {row.map(
                        (cell, columnIndex) => {
                          const isFocused =
                            gridFocusedCell?.row ===
                              rowIndex &&
                            gridFocusedCell?.column ===
                              columnIndex;

                          return (
                            <td
                              key={`${rowIndex}-${columnIndex}`}
                              className={`min-w-[180px] border p-0 ${
                                isFocused
                                  ? "border-white/10 bg-cyan-400/5"
                                  : "border-white/10 bg-slate-950/30"
                              }`}
                            >
                              <input
                                ref={(element) => {
                                  gridInputRefs.current[
                                    `${rowIndex}-${columnIndex}`
                                  ] =
                                    element;
                                }}
                                type="text"
                                value={cell}
                                readOnly={
                                  isCompleted
                                }
                                dir="ltr"
                                spellCheck
                                autoComplete="off"
                                inputMode="text"
                                aria-label={`Row ${
                                  rowIndex + 1
                                }, Column ${
                                  columnIndex + 1
                                }`}
                                onFocus={() => {
                                  setSelectedGridRow(
                                    rowIndex
                                  );

                                  setSelectedGridColumn(
                                    columnIndex
                                  );

                                  setGridFocusedCell({
                                    row: rowIndex,
                                    column:
                                      columnIndex,
                                  });
                                }}
                                onChange={(event) => {
                                  updateGridCell(
                                    rowIndex,
                                    columnIndex,
                                    event.target.value
                                  );
                                }}
                                onKeyDown={(
                                  event
                                ) => {
                                  if (
                                    event.key ===
                                    "Tab"
                                  ) {
                                    event.preventDefault();

                                    moveGridCell(
                                      rowIndex,
                                      columnIndex,
                                      0,
                                      event.shiftKey
                                        ? -1
                                        : 1
                                    );

                                    return;
                                  }

                                  if (
                                    event.key ===
                                    "Enter"
                                  ) {
                                    event.preventDefault();

                                    moveGridCell(
                                      rowIndex,
                                      columnIndex,
                                      event.shiftKey
                                        ? -1
                                        : 1,
                                      0
                                    );

                                    return;
                                  }

                                  if (
                                    event.key ===
                                    "ArrowDown"
                                  ) {
                                    event.preventDefault();

                                    moveGridCell(
                                      rowIndex,
                                      columnIndex,
                                      1,
                                      0
                                    );

                                    return;
                                  }

                                  if (
                                    event.key ===
                                    "ArrowUp"
                                  ) {
                                    event.preventDefault();

                                    moveGridCell(
                                      rowIndex,
                                      columnIndex,
                                      -1,
                                      0
                                    );

                                    return;
                                  }

                                  if (
                                    event.key ===
                                    "ArrowRight"
                                  ) {
                                    const input =
                                      event.currentTarget;

                                    if (
                                      input.selectionStart ===
                                        input.selectionEnd &&
                                      input.selectionEnd ===
                                        input.value.length
                                    ) {
                                      event.preventDefault();

                                      moveGridCell(
                                        rowIndex,
                                        columnIndex,
                                        0,
                                        1
                                      );
                                    }

                                    return;
                                  }

                                  if (
                                    event.key ===
                                    "ArrowLeft"
                                  ) {
                                    const input =
                                      event.currentTarget;

                                    if (
                                      input.selectionStart ===
                                        input.selectionEnd &&
                                      input.selectionStart ===
                                        0
                                    ) {
                                      event.preventDefault();

                                      moveGridCell(
                                        rowIndex,
                                        columnIndex,
                                        0,
                                        -1
                                      );
                                    }
                                  }
                                }}
                                className="block min-h-[46px] w-full border-0 bg-transparent px-3 py-3 text-left text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:bg-cyan-400/5 focus:ring-1 focus:ring-inset focus:ring-cyan-400/40 read-only:cursor-default"
                                style={{
                                  direction: "ltr",
                                  unicodeBidi:
                                    "plaintext",
                                  textAlign:
                                    "left",
                                }}
                              />
                            </td>
                          );
                        }
                      )}
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>        )}

        <div className="pb-8 text-center text-xs text-slate-600">
          Ultima Lite · Work File Editor
        </div>
      </div>
    </main>
  );
}
