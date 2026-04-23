import { createContext, useContext } from 'react';
import type { Ticket } from '../../types/ticket';
import type { Socket } from 'socket.io-client';

export interface TicketContextType {
  ticket: Ticket | null;
  user: any;
  socket: Socket | null;
  id: string | undefined;
  externalTicketId?: string;
  loadTicket: () => void;
  canInvite: boolean;
  serviceDuration: string;

  // Modals state
  editModalOpen: boolean;
  setEditModalOpen: (open: boolean) => void;
  inviteModalOpen: boolean;
  setInviteModalOpen: (open: boolean) => void;
  lockModalOpen: boolean;
  setLockModalOpen: (open: boolean) => void;
  knowledgeModalOpen: boolean;
  setKnowledgeModalOpen: (open: boolean) => void;

  // Lock specific
  lockDisableExternal: boolean;
  setLockDisableExternal: (disable: boolean) => void;
  // AI specific
  draftKnowledge: any;
  setDraftKnowledge: (k: any) => void;
  draftContent: string;
  setDraftContent: (c: string) => void;
}

const TicketContext = createContext<TicketContextType | undefined>(undefined);

export const useTicketContext = () => {
  const context = useContext(TicketContext);
  if (!context) {
    throw new Error('useTicketContext must be used within a TicketProvider');
  }
  return context;
};

export const TicketProvider = TicketContext.Provider;
