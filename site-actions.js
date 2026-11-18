// Registers this website's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// Operations return {ok: false, reason, field} when they refuse input, before changing
// anything, and throw only on unexpected failures. A throw is reported as "unknown".
// Import the page script by the same URL the page uses (no ?v= query), or the actions
// get a second, separate copy of the page state.
import { App } from "./script.js";

/**
 * Describes the site's operations as actions the agents can call.
 *
 * Each action wraps a function the page already uses, so the assistant and the manual
 * UI share one set of rules. The runtime validates arguments against inputSchema before
 * execute runs. This site has no irreversible actions: reads run without a dialog, and
 * the two writes only touch the visitor's own browser localStorage.
 */
class SiteActions {
  /**
   * Register every site action with the runtime.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static registerActions(actions) {
    actions.register(SiteActions.getProgramDataAction());
    actions.register(SiteActions.getChecklistAction());
    actions.register(SiteActions.getFindingAction());
    actions.register(SiteActions.searchProgramsAction());
    actions.register(SiteActions.getSiteInfoAction());
    actions.register(SiteActions.saveTriageNoteAction());
    actions.register(SiteActions.deleteTriageNoteAction());
  }

  static getProgramDataAction() {
    return {
      name: "get_program_data",
      description: "Read one program from the desk's triage table by id or name (for example 'ticko' or 'Ticko'). Returns the program's platform, status, verdict, rewards, gates, and how to file. Returns ok false when no program matches. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            minLength: 1,
            maxLength: 100,
            description: "Program id or name from the desk's program table.",
          },
        },
      },
      execute: SiteActions.getProgramData,
    };
  }

  static getProgramData(args) {
    const q = args.query.trim().toLowerCase();
    const state = App.page.getState();
    const match = state.programs.find((p) => p.id.toLowerCase() === q || p.name.toLowerCase() === q)
      || state.programs.find((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
    if (!match) {
      return { ok: false, reason: `No program named "${args.query}" is on this desk. Use website_search_programs to list the programs the desk tracks.`, field: "query" };
    }
    return match;
  }

  static getChecklistAction() {
    return {
      name: "get_checklist",
      description: "Read one checklist from the desk's checklist library by id: 'triage' (program triage), 'poc' (PoC verification), 'safe-testing' (safe-testing rules), or 'audit' (contract audit checklist). Returns the checklist title and its items. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["checklistId"],
        properties: {
          checklistId: {
            type: "string",
            enum: ["triage", "poc", "safe-testing", "audit"],
            description: "Checklist id from the desk's checklist library.",
          },
        },
      },
      execute: SiteActions.getChecklist,
    };
  }

  static getChecklist(args) {
    const state = App.page.getState();
    const found = state.checklists.find((c) => c.id === args.checklistId);
    if (!found) {
      return { ok: false, reason: `No checklist "${args.checklistId}" exists.`, field: "checklistId" };
    }
    return found;
  }

  static getFindingAction() {
    return {
      name: "get_finding",
      description: "Read one entry from the desk's findings log by id (for example 'openai-s1'). Returns the finding's title, program, status, date, summary, and lesson. The log holds closed or out-of-scope findings only, at a high level, with no exploit detail. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["findingId"],
        properties: {
          findingId: {
            type: "string",
            enum: ["openai-c1", "openai-c2", "openai-s1", "grafana-a-c1", "xe-dups"],
            description: "Finding id from the desk's findings log.",
          },
        },
      },
      execute: SiteActions.getFinding,
    };
  }

  static getFinding(args) {
    const state = App.page.getState();
    const found = state.findings.find((f) => f.id === args.findingId);
    if (!found) {
      return { ok: false, reason: `No finding "${args.findingId}" is in the log.`, field: "findingId" };
    }
    return found;
  }

  static searchProgramsAction() {
    return {
      name: "search_programs",
      description: "Filter the desk's program triage table. Returns the matching programs (id, name, platform, status, verdict, rewards). With no filters, returns the whole table. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          verdict: {
            type: "string",
            enum: ["PASS", "CAUTION", "FAIL"],
            description: "Only programs with this triage verdict.",
          },
          free: {
            type: "boolean",
            description: "True for programs with no submission fee; false for programs that charge one.",
          },
          query: {
            type: "string",
            minLength: 1,
            maxLength: 100,
            description: "Free text matched against the program name and platform.",
          },
        },
      },
      execute: SiteActions.searchPrograms,
    };
  }

  static searchPrograms(args) {
    const state = App.page.getState();
    let rows = state.programs;
    if (args.verdict) rows = rows.filter((p) => p.verdict === args.verdict);
    if (args.free !== undefined) rows = rows.filter((p) => p.free === args.free);
    if (args.query) {
      const q = args.query.trim().toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.platform.toLowerCase().includes(q));
    }
    return rows.map((p) => ({
      id: p.id, name: p.name, platform: p.platform, status: p.status,
      verdict: p.verdict, rewards: p.rewards,
    }));
  }

  static getSiteInfoAction() {
    return {
      name: "get_site_info",
      description: "Read this site's own facts: today's date, the site name, the link to the Agent Atlas trust-checker site and its network URL, and the URLs of this site's agent manifest and network file. Use it when the visitor asks how this site works or asks for a link to Agent Atlas. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: SiteActions.getSiteInfo,
    };
  }

  static getSiteInfo() {
    const state = App.page.getState();
    return { today: state.today, ...state.pageFacts };
  }

  static saveTriageNoteAction() {
    return {
      name: "save_triage_note",
      description: "Save the visitor's own triage note for a program to their shortlist, stored only in their browser's localStorage. Nothing leaves the browser. The visitor can delete it on the page. Returns the saved note and the updated shortlist, or ok false with a reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["programId", "note"],
        properties: {
          programId: {
            type: "string",
            minLength: 1,
            maxLength: 100,
            description: "Program id from website_get_program_data or website_search_programs.",
          },
          note: {
            type: "string",
            minLength: 1,
            maxLength: 500,
            description: "The visitor's own note (up to 500 characters).",
          },
        },
      },
      execute: SiteActions.saveTriageNote,
    };
  }

  static saveTriageNote(args) {
    return App.page.saveNote(args);
  }

  static deleteTriageNoteAction() {
    return {
      name: "delete_triage_note",
      description: "Delete one of the visitor's own triage notes from their shortlist (their browser's localStorage) by its id. Returns the updated shortlist, or ok false when the note is not on the shortlist.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: 100,
            description: "Note id from website_save_triage_note or the shortlist on the page.",
          },
        },
      },
      execute: SiteActions.deleteTriageNote,
    };
  }

  static deleteTriageNote(args) {
    return App.page.deleteNote(args);
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
