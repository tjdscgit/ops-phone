// Ask — a port of apps/web's /chat (chat-thread.tsx). Read-only natural-
// language query over tasks, projects, notes, quotes, annotations, people,
// routines and the calendar, answered by an agentic Claude loop running
// server-side in the `ask-chat` Edge Function (supabase/functions/ask-chat)
// since this static app has nowhere of its own to hold ANTHROPIC_API_KEY.
//
// Conversation state is in-memory only, same as the dashboard (no
// persistence there either) — it resets whenever this view is entered,
// same as leaving and returning to the /chat page would reset React state.
//
// Voice input (chat-thread.tsx's MediaRecorder → /api/capture/transcribe)
// is a deliberate gap, not silently dropped: it needs its own Edge
// Function port (a separate transcription endpoint), same call as image
// upload being left off the Library port.

import { sb } from '../lib/db.js';
import { el, panel, screenHead, hint } from '../lib/ui.js';

const EXAMPLES = [
  'What did I work on last week?',
  'How many open tasks are in Growing?',
  'Show notes tagged stewardship.',
  "What's on my calendar today?",
];

export async function askView(mount) {
  let turns = []; // { id, question, state: 'asking' | {ok:true,answer,tools} | {ok:false,error} }
  let pending = false;

  const input = el('textarea', {
    rows: 2,
    placeholder: 'Ask anything. "What did I work on last week?" or "Show every note tagged stewardship."',
  });
  const askBtn = el('button', { class: 'primary', type: 'button', disabled: true, onclick: submit }, 'Ask');
  const resetBtn = el('button', {
    class: 'ghost small', type: 'button', onclick: resetThread,
  }, 'New conversation');
  const thread = el('div', { class: 'ask-thread' });
  const emptyHint = hint('Examples: “' + EXAMPLES.join('” · “') + '”');

  input.onkeydown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };
  // React re-derives `disabled={pending || !input.trim()}` on every
  // keystroke for free; this port needs an explicit listener to keep the
  // button in sync as the user types (setPending() alone only updates it
  // around a submit, so it would otherwise stay disabled forever after the
  // input is cleared post-submit).
  input.oninput = () => { askBtn.disabled = pending || !input.value.trim(); };

  function setPending(next) {
    pending = next;
    input.disabled = pending;
    askBtn.disabled = pending || !input.value.trim();
    askBtn.textContent = pending ? 'Asking…' : 'Ask';
  }

  function turnNode(t) {
    const you = el('div', { class: 'ask-turn-row' },
      el('div', { class: 'ask-turn-who' }, 'You'),
      el('div', { class: 'ask-turn-body' }, t.question),
    );

    let answerBody;
    if (t.state === 'asking') {
      answerBody = el('div', { class: 'hint' }, 'Thinking…');
    } else if (t.state.ok === false) {
      answerBody = el('div', { class: 'ask-error' }, `Error: ${t.state.error}`);
    } else {
      const parts = [el('div', { class: 'ask-answer' }, t.state.answer)];
      if (t.state.tools.length > 0) {
        parts.push(
          el('details', { class: 'ask-tools' },
            el('summary', {}, `${t.state.tools.length} tool ${t.state.tools.length === 1 ? 'call' : 'calls'}`),
            el('ul', {}, ...t.state.tools.map((tool) =>
              el('li', {}, `${tool.name}(${JSON.stringify(tool.input)})`))),
          ),
        );
      }
      answerBody = el('div', {}, ...parts);
    }

    return el('div', { class: 'ask-turn' },
      you,
      el('div', { class: 'ask-turn-row' },
        el('div', { class: 'ask-turn-who' }, 'Claude'),
        el('div', { class: 'ask-turn-body' }, answerBody),
      ),
    );
  }

  function render() {
    thread.replaceChildren(...turns.map(turnNode));
    resetBtn.style.display = turns.length ? '' : 'none';
    emptyHint.style.display = turns.length ? 'none' : '';
    thread.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function resetThread() {
    if (pending) return;
    turns = [];
    input.value = '';
    render();
    input.focus();
  }

  async function submit() {
    const question = input.value.trim();
    if (!question || pending) return;

    // Same history-building rule as chat-thread.tsx: every prior
    // *successful* turn contributes a user+assistant pair; failed/pending
    // turns are skipped, then the new question is appended last.
    const history = [];
    for (const t of turns) {
      if (typeof t.state === 'object' && t.state.ok === true) {
        history.push({ role: 'user', content: t.question });
        history.push({ role: 'assistant', content: t.state.answer });
      }
    }
    history.push({ role: 'user', content: question });

    const id = crypto.randomUUID();
    turns = [...turns, { id, question, state: 'asking' }];
    input.value = '';
    setPending(true);
    render();

    let outcome;
    try {
      const { data, error } = await sb.functions.invoke('ask-chat', {
        method: 'POST',
        body: { messages: history },
      });
      if (error) {
        outcome = { ok: false, error: await describeFunctionError(error) };
      } else if (data?.error) {
        outcome = { ok: false, error: data.message || data.error };
      } else {
        outcome = {
          ok: true,
          answer: data.answer,
          tools: (data.tool_trace || []).map((tr) => ({ name: tr.name, input: tr.input })),
        };
      }
    } catch (err) {
      outcome = { ok: false, error: err?.message || String(err) };
    }

    turns = turns.map((t) => (t.id === id ? { ...t, state: outcome } : t));
    setPending(false);
    render();
  }

  render();

  mount.replaceChildren(
    screenHead('Ask', 'Chat', { meta: 'Read-only query over tasks, projects, notes, quotes, calendar' }),
    panel(
      el('div', { class: 'ask-input-row' }, input, askBtn),
      el('div', { class: 'ask-toolbar' }, el('span', {}), resetBtn),
    ),
    emptyHint,
    thread,
  );
  input.focus();
}

// supabase-js throws a FunctionsHttpError/FunctionsRelayError whose
// `.context` is the raw Response — read it for the JSON body's message if
// there is one, falling back to the generic error message.
async function describeFunctionError(error) {
  try {
    if (error?.context?.json) {
      const body = await error.context.json();
      if (body?.message || body?.error) return body.message || body.error;
    }
  } catch { /* body wasn't JSON or already consumed */ }
  return error?.message || 'Could not reach Ask';
}
