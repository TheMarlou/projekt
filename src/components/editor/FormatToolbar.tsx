import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { ACTIONS_CURSEUR, ACTIONS_SELECTION } from "../../lib/aiPrompts";
import { AUDIO_EXTENSIONS, insertAudioFile } from "./AudioClip";
import { AUDIO_REQUEST_EVENT, IMAGE_REQUEST_EVENT, LINK_REQUEST_EVENT, requestInlineAi } from "./editorEvents";
import { FONT_CHOICES, findFontChoice } from "./fonts";
import { insertImageFile } from "./ProjektImage";

// Le corps de texte de l'éditeur vaut 15px : c'est la taille « par défaut », et
// les autres valeurs s'échelonnent autour pour rester lisibles à l'écran.
const DEFAULT_FONT_SIZE = 15;
const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 24, 30, 36, 48];

// Mêmes intitulés que pour l'image : le tableau se place exactement de la même façon.
const WRAP_MODES = [
  { value: "none", label: "Pleine ligne" },
  { value: "left", label: "Texte à droite" },
  { value: "center", label: "Centré" },
  { value: "right", label: "Texte à gauche" },
] as const;

/** Bloc et lignes de texte : dit d'un coup d'œil de quel côté le texte coulera. */
function WrapIcon({ kind }: { kind: (typeof WRAP_MODES)[number]["value"] }) {
  const bloc = { none: [0, 14], center: [4, 6], left: [0, 6], right: [8, 6] }[kind];
  const lignes = kind === "left" ? [7.5, 6.5] : kind === "right" ? [0, 7.5] : null;
  return (
    <svg width="14" height="11" viewBox="0 0 14 11" aria-hidden focusable="false">
      <rect x={bloc[0]} y="0" width={bloc[1]} height="11" rx="1" fill="currentColor" opacity="0.55" />
      {lignes &&
        [0, 3, 6, 9].map((y) => (
          <rect key={y} x={lignes[0]} y={y} width={lignes[1]} height="1.4" rx="0.7" fill="currentColor" />
        ))}
    </svg>
  );
}

const ALIGNMENTS = [
  { value: "left", label: "Aligné à gauche" },
  { value: "center", label: "Centré" },
  { value: "right", label: "Aligné à droite" },
  { value: "justify", label: "Justifié" },
] as const;

type AlignValue = (typeof ALIGNMENTS)[number]["value"];

// Petites barres de longueurs variables : c'est le pictogramme d'alignement
// universel, et aucun caractère Unicode ne le rend correctement.
function AlignIcon({ kind }: { kind: AlignValue }) {
  const widths =
    kind === "center" ? [12, 8, 12, 8] : kind === "right" ? [12, 8, 12, 8] : kind === "justify" ? [12, 12, 12, 12] : [12, 8, 12, 8];
  return (
    <svg width="14" height="11" viewBox="0 0 14 11" aria-hidden focusable="false">
      {widths.map((w, i) => {
        const x = kind === "center" ? (14 - w) / 2 : kind === "right" ? 14 - w : 0;
        return <rect key={i} x={x} y={i * 3} width={w} height="1.6" rx="0.8" fill="currentColor" />;
      })}
    </svg>
  );
}

const HIGHLIGHT_COLORS = [
  { label: "Jaune", value: "#f0c04a59" },
  { label: "Vert", value: "#5fb87a59" },
  { label: "Bleu", value: "#5b9ce659" },
  { label: "Violet", value: "#c77ee059" },
  { label: "Rouge", value: "#e8746459" },
];

const BLOCK_TYPES = [
  {
    label: "Texte",
    hint: "Ctrl+Alt+0",
    isActive: (e: Editor) => e.isActive("paragraph") && !e.isActive("blockquote"),
    run: (e: Editor) => e.chain().focus().setParagraph().run(),
  },
  {
    label: "Titre 1",
    hint: "Ctrl+Alt+1",
    isActive: (e: Editor) => e.isActive("heading", { level: 1 }),
    run: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    label: "Titre 2",
    hint: "Ctrl+Alt+2",
    isActive: (e: Editor) => e.isActive("heading", { level: 2 }),
    run: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    label: "Titre 3",
    hint: "Ctrl+Alt+3",
    isActive: (e: Editor) => e.isActive("heading", { level: 3 }),
    run: (e: Editor) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    label: "Citation",
    hint: "Ctrl+Maj+B",
    isActive: (e: Editor) => e.isActive("blockquote"),
    run: (e: Editor) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "Bloc de code",
    hint: "Ctrl+Alt+C",
    isActive: (e: Editor) => e.isActive("codeBlock"),
    run: (e: Editor) => e.chain().focus().toggleCodeBlock().run(),
  },
];

interface FormatToolbarProps {
  editor: Editor | null;
  projectId: string | null;
}

export default function FormatToolbar({ editor, projectId }: FormatToolbarProps) {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  // La barre reflète l'état du bloc sous le curseur : elle doit se redessiner à
  // chaque transaction de l'éditeur actif, pas seulement quand React le décide.
  useEffect(() => {
    if (!editor) return;
    const update = () => forceRender();
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  // Ctrl+K et les entrées « / » ne savent pas afficher un champ : ils délèguent ici.
  useEffect(() => {
    const openLink = () => {
      setOpenMenu(null);
      setLinkOpen(true);
    };
    const openImage = () => fileInput.current?.click();
    const openAudio = () => audioInput.current?.click();
    window.addEventListener(LINK_REQUEST_EVENT, openLink);
    window.addEventListener(IMAGE_REQUEST_EVENT, openImage);
    window.addEventListener(AUDIO_REQUEST_EVENT, openAudio);
    return () => {
      window.removeEventListener(LINK_REQUEST_EVENT, openLink);
      window.removeEventListener(IMAGE_REQUEST_EVENT, openImage);
      window.removeEventListener(AUDIO_REQUEST_EVENT, openAudio);
    };
  }, []);

  const off = !editor;
  const hasSelection = !!editor && !editor.state.selection.empty;
  const activeBlock = editor
    ? BLOCK_TYPES.find((b) => b.isActive(editor)) ?? BLOCK_TYPES[0]
    : BLOCK_TYPES[0];
  const activeFont = findFontChoice(editor?.getAttributes("textStyle").fontFamily as string | undefined);
  const rawSize = editor?.getAttributes("textStyle").fontSize as string | undefined;
  const activeSize = rawSize ? parseInt(rawSize, 10) || DEFAULT_FONT_SIZE : DEFAULT_FONT_SIZE;
  // Un paragraphe sans attribut d'alignement s'affiche à gauche : on le présente
  // comme tel plutôt que comme « aucun alignement », qui n'aurait aucun sens.
  const activeAlign: AlignValue =
    ALIGNMENTS.find((a) => editor?.isActive({ textAlign: a.value }))?.value ?? "left";
  const tableAlign = editor?.getAttributes("table").align as string | undefined;
  const activeTableWrap = WRAP_MODES.find((m) => m.value === tableAlign) ?? WRAP_MODES[0];

  // Toutes les actions IA passent par la fenêtre au curseur, qui montre un aperçu
  // à valider : la barre ne fait que la demander, avec l'action choisie.
  const lancerIa = (action?: string) => {
    setOpenMenu(null);
    requestInlineAi(action);
  };

  const pickImage = async (file: File | undefined) => {
    if (!editor || !file) return;
    await insertImageFile(editor, projectId, file);
  };

  return (
    <div style={barStyle}>
      <Family caption="Bloc">
        <Menu
          id="bloc"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          disabled={off}
          trigger={<span style={{ minWidth: 56, textAlign: "left" }}>{activeBlock.label}</span>}
          width={190}
        >
          {BLOCK_TYPES.map((b) => (
            <MenuItem
              key={b.label}
              label={b.label}
              hint={b.hint}
              active={!!editor && b.isActive(editor)}
              onSelect={() => editor && b.run(editor)}
            />
          ))}
        </Menu>
        <Menu
          id="alignement"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          disabled={off}
          title="Alignement du paragraphe"
          trigger={<AlignIcon kind={activeAlign} />}
          width={196}
        >
          {ALIGNMENTS.map((a) => (
            <MenuItem
              key={a.value}
              label={a.label}
              active={activeAlign === a.value}
              onSelect={() => editor?.chain().focus().setTextAlign(a.value).run()}
            />
          ))}
        </Menu>
      </Family>

      <Family caption="Police">
        <Menu
          id="police"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          disabled={off}
          title="Police de caractères"
          trigger={
            <span style={{ minWidth: 70, textAlign: "left", fontFamily: activeFont.stack || undefined }}>
              {activeFont.label}
            </span>
          }
          width={268}
        >
          {FONT_CHOICES.map((f) => (
            <MenuItem
              key={f.label}
              label={f.label}
              hint={f.hint}
              fontStack={f.stack}
              active={activeFont.label === f.label}
              onSelect={() =>
                f.stack
                  ? editor?.chain().focus().setFontFamily(f.stack).run()
                  : editor?.chain().focus().unsetFontFamily().run()
              }
            />
          ))}
        </Menu>
        <Menu
          id="taille"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          disabled={off}
          title="Taille du texte"
          trigger={<span style={{ minWidth: 18, textAlign: "right" }}>{activeSize}</span>}
          width={150}
        >
          {FONT_SIZES.map((size) => (
            <MenuItem
              key={size}
              label={String(size)}
              hint={size === DEFAULT_FONT_SIZE ? "défaut" : undefined}
              active={activeSize === size}
              onSelect={() =>
                size === DEFAULT_FONT_SIZE
                  ? editor?.chain().focus().unsetFontSize().run()
                  : editor?.chain().focus().setFontSize(`${size}px`).run()
              }
            />
          ))}
        </Menu>
      </Family>

      <Family caption="Texte">
        <Tool
          label="G"
          title="Gras — Ctrl+B"
          bold
          disabled={off}
          active={!!editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        />
        <Tool
          label="I"
          title="Italique — Ctrl+I"
          italic
          disabled={off}
          active={!!editor?.isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        />
        <Tool
          label="S"
          title="Souligné — Ctrl+U"
          underline
          disabled={off}
          active={!!editor?.isActive("underline")}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        />
        <Tool
          label="S"
          title="Barré — Ctrl+Maj+S"
          strike
          disabled={off}
          active={!!editor?.isActive("strike")}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        />
        <Tool
          label="{ }"
          title="Code en ligne — Ctrl+E"
          disabled={off}
          active={!!editor?.isActive("code")}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        />
        <Menu
          id="surlignage"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          disabled={off}
          active={!!editor?.isActive("highlight")}
          title="Surlignage — Ctrl+Maj+H"
          trigger={<span style={{ borderBottom: "3px solid #f0c04a", lineHeight: 1.1 }}>A</span>}
          width={150}
        >
          {HIGHLIGHT_COLORS.map((c) => (
            <MenuItem
              key={c.value}
              label={c.label}
              swatch={c.value}
              active={!!editor?.isActive("highlight", { color: c.value })}
              onSelect={() => editor?.chain().focus().setHighlight({ color: c.value }).run()}
            />
          ))}
          <MenuItem label="Aucun" onSelect={() => editor?.chain().focus().unsetHighlight().run()} />
        </Menu>
      </Family>

      <Family caption="Listes">
        <Tool
          label="•"
          title="Liste à puces — Ctrl+Maj+8"
          disabled={off}
          active={!!editor?.isActive("bulletList")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        />
        <Tool
          label="1."
          title="Liste numérotée — Ctrl+Maj+7"
          disabled={off}
          active={!!editor?.isActive("orderedList")}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        />
        <Tool
          label="☑"
          title="Cases à cocher — Ctrl+Maj+9"
          disabled={off}
          active={!!editor?.isActive("taskList")}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
        />
      </Family>

      <Family caption="Insertion">
        <Tool
          label="🔗"
          title="Lien — Ctrl+K"
          disabled={off}
          active={!!editor?.isActive("link") || linkOpen}
          onClick={() => {
            setOpenMenu(null);
            setLinkOpen((v) => !v);
          }}
        />
        <Tool
          label="🖼"
          title="Image (fichier local)"
          disabled={off}
          onClick={() => fileInput.current?.click()}
        />
        <Tool
          label="⊞"
          title="Tableau 3×3"
          disabled={off}
          onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        />
        <Tool
          label="—"
          title="Séparateur"
          disabled={off}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        />
      </Family>

      {/* Famille contextuelle, à la manière de l'onglet « Tableau » de Word : elle
          n'apparaît que dans un tableau, ce qui évite d'encombrer la barre le reste
          du temps — elle est déjà pleine à la largeur par défaut. */}
      {editor?.isActive("table") && (
        <Family caption="Tableau">
          <Menu
            id="tableau-placement"
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
            title={"Placement du tableau — " + activeTableWrap.label}
            trigger={<WrapIcon kind={activeTableWrap.value} />}
            width={210}
          >
            {WRAP_MODES.map((m) => (
              <MenuItem
                key={m.value}
                label={m.label}
                active={activeTableWrap.value === m.value}
                onSelect={() => editor.chain().focus().updateAttributes("table", { align: m.value }).run()}
              />
            ))}
          </Menu>
          <Tool label="+↔" title="Ajouter une colonne" onClick={() => editor.chain().focus().addColumnAfter().run()} />
          <Tool label="−↔" title="Supprimer la colonne" onClick={() => editor.chain().focus().deleteColumn().run()} />
          <Tool label="+↕" title="Ajouter une ligne" onClick={() => editor.chain().focus().addRowAfter().run()} />
          <Tool label="−↕" title="Supprimer la ligne" onClick={() => editor.chain().focus().deleteRow().run()} />
          <Tool label="✕" title="Supprimer le tableau" onClick={() => editor.chain().focus().deleteTable().run()} />
        </Family>
      )}

      <Family caption="IA">
        <Menu
          id="ia"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          disabled={off}
          title={hasSelection ? "Travailler la sélection avec l'IA" : "Écrire avec l'IA à partir du curseur"}
          trigger={<span>✦ IA</span>}
          width={340}
        >
          <MenuItem label="Demander à l'IA…" hint="Ctrl+Espace" onSelect={() => lancerIa()} />
          {(hasSelection ? ACTIONS_SELECTION : ACTIONS_CURSEUR).map((a) => (
            <MenuItem key={a.libelle} label={a.libelle} hint={a.aide} onSelect={() => lancerIa(a.libelle)} />
          ))}
        </Menu>
      </Family>

      <Family caption="Historique" last>
        <Tool
          label="↶"
          title="Annuler — Ctrl+Z"
          disabled={off || !editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
        />
        <Tool
          label="↷"
          title="Rétablir — Ctrl+Y"
          disabled={off || !editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
        />
      </Family>

      {linkOpen && editor && <LinkEditor editor={editor} onClose={() => setLinkOpen(false)} />}

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          void pickImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {/* Pas de bouton visible pour l'audio : la barre est pleine. On y accède par
          le clic droit et par « / », qui réclament ce sélecteur. */}
      <input
        ref={audioInput}
        type="file"
        accept={`audio/*,${AUDIO_EXTENSIONS.map((e) => `.${e}`).join(",")}`}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const fichiers = Array.from(e.target.files ?? []);
          e.target.value = "";
          void (async () => {
            if (!editor) return;
            for (const f of fichiers) await insertAudioFile(editor, projectId, f);
          })();
        }}
      />
    </div>
  );
}

function LinkEditor({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  // Une image n'est pas du texte : elle ne peut pas porter la marque « lien »,
  // l'adresse va dans un attribut du nœud. Le champ, lui, reste le même.
  const onImage = editor.isActive("image");
  const existing =
    ((onImage ? editor.getAttributes("image").href : editor.getAttributes("link").href) as string) ??
    "";
  const [value, setValue] = useState(existing);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const apply = () => {
    const href = value.trim();
    // Sans schéma, le navigateur interpréterait l'URL comme un chemin relatif.
    const normalized = href && !/^[a-z][a-z0-9+.-]*:/i.test(href) ? `https://${href}` : href;

    if (onImage) {
      editor.chain().focus().updateAttributes("image", { href: normalized || null }).run();
    } else if (!normalized) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
    }
    onClose();
  };

  return (
    <div
      style={{
        ...panelStyle,
        position: "absolute",
        top: "100%",
        right: 12,
        marginTop: 4,
        width: 340,
        padding: 8,
      }}
    >
      <div style={{ display: "flex", gap: 6 }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
            if (e.key === "Escape") onClose();
          }}
          placeholder="https://exemple.com"
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            padding: "5px 8px",
            fontSize: 12.5,
            outline: "none",
          }}
        />
        <button onClick={apply} style={{ ...ghost, borderColor: "var(--accent)", color: "var(--accent)" }}>
          Appliquer
        </button>
        {existing && (
          <button
            onClick={() => {
              if (onImage) {
                editor.chain().focus().updateAttributes("image", { href: null }).run();
              } else {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
              }
              onClose();
            }}
            style={ghost}
          >
            Retirer
          </button>
        )}
      </div>
    </div>
  );
}

function Family({ caption, children, last }: { caption: string; children: ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        padding: "0 4px",
        flex: "0 0 auto",
        borderRight: last ? "none" : "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>{children}</div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
        }}
      >
        {caption}
      </div>
    </div>
  );
}

function Tool({
  label,
  title,
  active,
  disabled,
  onClick,
  bold,
  italic,
  underline,
  strike,
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      // mousedown neutralisé : sans ça l'éditeur perd le focus et la sélection
      // avant même que la commande ne s'exécute.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        minWidth: 25,
        height: 26,
        fontSize: 12.5,
        padding: "0 5px",
        borderRadius: 5,
        border: "none",
        background: active ? "var(--accent-soft)" : "transparent",
        color: disabled ? "var(--border)" : active ? "var(--accent)" : "var(--text-dim)",
        fontWeight: bold ? 700 : 500,
        fontStyle: italic ? "italic" : "normal",
        textDecoration: underline ? "underline" : strike ? "line-through" : "none",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Menu({
  id,
  openMenu,
  setOpenMenu,
  trigger,
  children,
  width,
  disabled,
  active,
  title,
}: {
  id: string;
  openMenu: string | null;
  setOpenMenu: (v: string | null) => void;
  trigger: ReactNode;
  children: ReactNode;
  width: number;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  const open = openMenu === id;
  const ref = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, setOpenMenu]);

  // La barre défile horizontalement (sinon elle passait sur plusieurs lignes) :
  // un panneau en `absolute` à l'intérieur était donc ROGNÉ par elle, et il
  // fallait faire défiler la barre pour voir le menu. En position fixe, calculée
  // sur le bouton, il en sort — et on le retient dans l'écran près des bords.
  useLayoutEffect(() => {
    if (!open) return;
    const placer = () => {
      const r = bouton.current?.getBoundingClientRect();
      if (!r) return;
      const top = r.bottom + 4;
      setPlace({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        top,
        maxHeight: Math.max(120, window.innerHeight - top - 12),
      });
    };
    placer();
    window.addEventListener("resize", placer);
    // Capture : le défilement de la barre elle-même doit aussi replacer le menu.
    window.addEventListener("scroll", placer, true);
    return () => {
      window.removeEventListener("resize", placer);
      window.removeEventListener("scroll", placer, true);
    };
  }, [open, width]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={bouton}
        title={title}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpenMenu(open ? null : id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          height: 26,
          fontSize: 12.5,
          padding: "0 7px",
          borderRadius: 5,
          border: "none",
          background: open || active ? "var(--accent-soft)" : "transparent",
          color: disabled ? "var(--border)" : open || active ? "var(--accent)" : "var(--text-dim)",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {trigger}
        <span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
      </button>
      {open && place && (
        // Un clic sur n'importe quelle entrée referme le menu : la commande a déjà
        // été appliquée par l'entrée elle-même, garder le panneau ouvert masquerait
        // le résultat.
        <div
          onClick={() => setOpenMenu(null)}
          style={{
            ...panelStyle,
            position: "fixed",
            left: place.left,
            top: place.top,
            maxHeight: place.maxHeight,
            overflowY: "auto",
            width,
            zIndex: 80,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  hint,
  active,
  swatch,
  fontStack,
  onSelect,
}: {
  label: string;
  hint?: string;
  active?: boolean;
  swatch?: string;
  /** Affiche l'entrée dans sa propre police, pour choisir sur pièce. */
  fontStack?: string;
  onSelect: () => void;
}) {
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 9px",
        borderRadius: 5,
        fontSize: 12.5,
        cursor: "pointer",
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--text)",
      }}
    >
      {swatch && (
        <span
          style={{
            width: 13,
            height: 13,
            borderRadius: 3,
            background: swatch,
            border: "1px solid var(--border)",
          }}
        />
      )}
      <span style={{ flex: 1, fontFamily: fontStack || undefined, fontSize: fontStack ? 13.5 : undefined }}>
        {label}
      </span>
      {hint && (
        <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}

const barStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "stretch",
  // Une seule rangée, quitte à défiler : en repliant, la barre passait à trois
  // rangées sous 1100px, et l'apparition de la famille contextuelle « Tableau »
  // faisait sauter tout le document vers le bas.
  flexWrap: "nowrap",
  overflowX: "auto",
  scrollbarWidth: "thin",
  scrollbarColor: "var(--border) transparent",
  // Hauteur figée : une barre de défilement horizontale prend de la place en
  // hauteur, et son apparition à l’entrée dans un tableau décalait tout le
  // document vers le bas.
  height: 66,
  gap: 0,
  padding: "7px 8px 5px",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  zIndex: 20,
};

const panelStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  boxShadow: "0 12px 28px rgba(0,0,0,0.35)",
  padding: 4,
  zIndex: 70,
};

const ghost: CSSProperties = {
  fontSize: 12,
  padding: "5px 10px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
  whiteSpace: "nowrap",
};
