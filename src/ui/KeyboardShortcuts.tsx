// src/ui/KeyboardShortcuts.tsx — the on-screen key list (M9 step 9): the rows of KEY_MAP, which keyboard.ts keeps next
// to its handler, so the list and the keys cannot drift apart. No store state and no key of its own. Layout and look
// are visual design, settled from screenshots.
import { KEY_MAP } from "../app/keyboard";

export function KeyboardShortcuts() {
  return (
    <details className="shortcuts">
      <summary>Keyboard shortcuts</summary>
      <div className="shortcuts-panel">
        <table aria-label="Keyboard shortcuts">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Effect</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {KEY_MAP.map((row) => (
              <tr key={row.keys}>
                <th scope="row">{row.keys}</th>
                <td>{row.effect}</td>
                <td>{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Keys do nothing while a text field, slider or list has focus, or with Alt, Ctrl or Cmd
          held.
        </p>
      </div>
    </details>
  );
}
