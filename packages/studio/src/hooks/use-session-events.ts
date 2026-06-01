import { useEffect } from "react";
import type { SSEMessage } from "./use-sse";
import type { HashRoute } from "./use-hash-route";
import { useChatStore } from "../store/chat";
import { bookKey, mergeSessionIds, updateSession } from "../store/chat/slices/message/runtime";
import { clearPaperCreateSessionId, getPaperCreateSessionId } from "../pages/chat-page-state";

/**
 * Listens for global SSE events related to sessions:
 * - session:title — AI-generated title push, updates sidebar display
 * - paper:created — new paper creation, migrates session from null to new paper, clears localStorage, navigates
 */
export function useSessionEvents(
  sse: { messages: ReadonlyArray<SSEMessage> },
  route: HashRoute,
  setRoute: (route: HashRoute) => void,
): void {
  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;

    if (recent.event === "session:title") {
      const data = recent.data as { sessionId?: string; title?: string } | null;
      if (!data?.sessionId || !data.title) return;
      const { sessionId, title } = data;
      useChatStore.setState((state) => {
        const session = state.sessions[sessionId];
        if (!session) return {};
        return {
          sessions: updateSession(state.sessions, sessionId, () => ({ title })),
        };
      });
      return;
    }

    if (recent.event === "paper:created") {
      const data = recent.data as { sessionId?: string; paperId?: string } | null;
      if (!data?.sessionId || !data.paperId) return;
      const { sessionId, paperId } = data;

      useChatStore.setState((state) => {
        const session = state.sessions[sessionId];
        if (!session) return {};
        const previousKey = bookKey(session.bookId);
        const nextKey = bookKey(paperId);
        return {
          sessions: updateSession(state.sessions, sessionId, () => ({ bookId: paperId })),
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [previousKey]: (state.sessionIdsByBook[previousKey] ?? []).filter((id) => id !== sessionId),
            [nextKey]: mergeSessionIds(state.sessionIdsByBook[nextKey], [sessionId]),
          },
        };
      });

      if (getPaperCreateSessionId() === sessionId) {
        clearPaperCreateSessionId();
        if (route.page === "paper-create") {
          setRoute({ page: "paper-generate", paperId });
        }
      }
    }
  }, [route.page, setRoute, sse.messages]);
}
