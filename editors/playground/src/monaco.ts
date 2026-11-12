/**
 * Monaco, assembled from its parts: the editor API plus the feature
 * contributions this playground drives (hover, completion, signature help,
 * highlights, navigation, rename, outline, folding, hints, formatting,
 * semantic tokens) and the editing basics. The package's main entry would
 * also bundle every built-in language, none of which a craft needs.
 */
import "monaco-editor/features/codeEditor/register.js";
import "monaco-editor/features/codicon/register.js";
import "monaco-editor/features/bracketMatching/register.js";
import "monaco-editor/features/clipboard/register.js";
import "monaco-editor/features/comment/register.js";
import "monaco-editor/features/contextmenu/register.js";
import "monaco-editor/features/cursorUndo/register.js";
import "monaco-editor/features/documentSymbols/register.js";
import "monaco-editor/features/find/register.js";
import "monaco-editor/features/folding/register.js";
import "monaco-editor/features/format/register.js";
import "monaco-editor/features/gotoError/register.js";
import "monaco-editor/features/gotoLine/register.js";
import "monaco-editor/features/gotoSymbol/register.js";
import "monaco-editor/features/hover/register.js";
import "monaco-editor/features/indentation/register.js";
import "monaco-editor/features/inlayHints/register.js";
import "monaco-editor/features/linesOperations/register.js";
import "monaco-editor/features/multicursor/register.js";
import "monaco-editor/features/parameterHints/register.js";
import "monaco-editor/features/quickCommand/register.js";
import "monaco-editor/features/quickOutline/register.js";
import "monaco-editor/features/referenceSearch/register.js";
import "monaco-editor/features/rename/register.js";
import "monaco-editor/features/semanticTokens/register.js";
import "monaco-editor/features/smartSelect/register.js";
import "monaco-editor/features/snippet/register.js";
import "monaco-editor/features/suggest/register.js";
// The suggest feature's registration covers the inline part only; the
// controller that opens the completion list is registered here, as the
// package's own main entry does.
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/features/wordHighlighter/register.js";
import "monaco-editor/features/wordOperations/register.js";

export * as monaco from "monaco-editor/editor/editor.api.js";
