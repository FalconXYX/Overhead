// src/ui/KeyboardShortcuts.tsx — the on-screen key list (M9 step 9): the rows of KEY_MAP, which keyboard.ts keeps next
// to its handler, so the list and the keys cannot drift apart. No store state and no key of its own. [Redesign] The
// header's [?] popover (redesign spec section 2).
import { useState } from "react";
import { KEY_MAP } from "../app/keyboard";
import { Popover } from "./Popover";

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      label={<span aria-hidden="true">?</span>}
      buttonName="Keyboard shortcuts"
      title="Keyboard shortcuts"
      open={open}
      onOpenChange={setOpen}
      className="shortcuts"
      buttonClassName="btn-icon header-button"
    >
      <h2 className="popover-title">Keyboard shortcuts</h2>
      <table>
        <tbody>
          {KEY_MAP.map((row) => (
            <tr key={row.keys}>
              <th scope="row">{row.keys}</th>
              <td>
                {row.effect}
                {row.notes === "" ? null : <span className="shortcut-note">{row.notes}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="popover-foot">
        Keys do nothing while a text field, slider or list has focus, or with Alt, Ctrl or Cmd held.
      </p>
    </Popover>
  );
}
