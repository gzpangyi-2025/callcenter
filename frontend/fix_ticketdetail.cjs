const fs = require('fs');
const path = '/Users/yipang/Documents/code/callcenter/frontend/src/pages/Tickets/TicketDetail.tsx';
let content = fs.readFileSync(path, 'utf8');

// Remove ticketInfoPanel
content = content.replace(/\/\/ ==================== 工单信息面板 ====================\s*const ticketInfoPanel = \(\s*<>[\s\S]*?<\/Card>\s*<\/>\s*\);/, '');

// Replace Drawer content {ticketInfoPanel} -> <TicketSidebar />
content = content.replace(/\{ticketInfoPanel\}/g, '<TicketSidebar />');

// Replace all Modals with <TicketModals />
content = content.replace(/<Modal\s*title="邀请协作专家"[\s\S]*<\/Modal>[\s\S]*?<\/div>\s*\);\s*};\s*export default TicketDetail;/, '<TicketModals />\n    </div>\n  );\n};\n\nexport default TicketDetail;');

// Setup Context Value string
const contextValue = `
    ticket, user, socket, id, externalTicketId, loadTicket, canInvite, serviceDuration,
    editModalOpen, setEditModalOpen,
    inviteModalOpen, setInviteModalOpen,
    lockModalOpen, setLockModalOpen,
    knowledgeModalOpen, setKnowledgeModalOpen,
    lockDisableExternal, setLockDisableExternal,
    draftKnowledge, setDraftKnowledge,
    draftContent, setDraftContent
`;

// Add TicketProvider wrapper
content = content.replace(
  /<div className=\{\`ticket-workspace \$\{isMobile \? 'mobile' : ''\} fade-in\`\}>/,
  `<TicketProvider value={{${contextValue}}}>\n    <div className={\`ticket-workspace \${isMobile ? 'mobile' : ''} fade-in\`}>`
);

content = content.replace(
  /<TicketModals \/>\n    <\/div>\n  \);\n};/,
  '<TicketModals />\n    </div>\n    </TicketProvider>\n  );\n};'
);

fs.writeFileSync(path, content);
console.log("Done");
