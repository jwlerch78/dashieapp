// js/core/navigation.js - Navigation Logic & Focus Management with Timeout System
// CHANGE SUMMARY: Added feature flag support for enhanced focus mode with dynamic checking

import { state, elements, findWidget, setFocus, setSelectedCell, setCurrentMain } from './state.js';
import { isFeatureEnabled } from './feature-flags.js';

// Initialize body class based on feature flag
const initialMode = isFeatureEnabled('ENHANCED_FOCUS_MODE');
if (!initialMode) {
  document.body.classList.add('legacy-focus');
  console.log('📊 Initialized with LEGACY focus mode');
} else {
  console.log('🚀 Initialized with ENHANCED focus mode');
}

// ---------------------
// TIMEOUT MANAGEMENT
// ---------------------

let highlightTimer = null;
let isHighlightVisible = true;

const TIMEOUT_SELECTION = 20000; // 20 seconds for selection mode
const TIMEOUT_FOCUS = 60000;     // 60 seconds for focus mode

function startHighlightTimer() {
  clearHighlightTimer();
  
  const timeout = state.selectedCell ? TIMEOUT_FOCUS : TIMEOUT_SELECTION;
  
  highlightTimer = setTimeout(() => {
    hideHighlights();
  }, timeout);
}

function clearHighlightTimer() {
  if (highlightTimer) {
    clearTimeout(highlightTimer);
    highlightTimer = null;
  }
}

function hideHighlights() {
  isHighlightVisible = false;
  document.body.classList.add('highlights-hidden');
  
  // If a widget was focused and timed out, send escape command first then clear the selection
  if (state.selectedCell) {
    // Send escape to widget before defocusing so it can clean up (same as handleBack)
    const iframe = state.selectedCell.querySelector("iframe");
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ action: "escape" }, "*");
        console.log("✓ Sent 'escape' to widget due to timeout before defocusing");
      } catch (error) {
        console.warn("Failed to send escape to widget on timeout:", error);
      }
    }
    
    // Small delay to let widget process the escape, then defocus (same pattern as handleBack)
    setTimeout(() => {
      setSelectedCell(null);
      hideFocusOverlay();  // NEW: Hide overlay when timeout clears selection
      console.log(`Focused widget timed out - cleared selection after escape command`);
    }, 10);
  }
  
  // If sidebar is highlighted, close it entirely
  if (state.focus.type === "menu") {
    elements.sidebar.classList.remove("expanded");
    console.log(`Navigation highlights hidden and sidebar closed after timeout`);
  } else {
    console.log(`Navigation highlights hidden after timeout`);
  }
}

function showHighlights() {
  isHighlightVisible = true;
  document.body.classList.remove('highlights-hidden');
  startHighlightTimer();
  console.log(`Navigation highlights shown, timer started`);
}

function resetHighlightTimer() {
  if (!isHighlightVisible) {
    showHighlights();
  } else {
    startHighlightTimer();
  }
}

// ---------------------
// FOCUS OVERLAY MANAGEMENT
// ---------------------

function showFocusOverlay() {
  // Check current state dynamically (in case it was toggled in settings)
  const hasLegacyClass = document.body.classList.contains('legacy-focus');
  const isEnhancedMode = !hasLegacyClass;
  
  console.log(`🔍 Overlay check: hasLegacyClass=${hasLegacyClass}, isEnhancedMode=${isEnhancedMode}`);
  
  if (!isEnhancedMode) {
    console.log('⏭️ Skipping overlay show - legacy mode active');
    return;
  }
  
  const overlay = document.getElementById('focus-overlay');
  if (overlay) {
    overlay.classList.add('visible');
    console.log('✓ Focus overlay shown (enhanced mode)');
  } else {
    console.error('❌ Focus overlay element not found!');
  }
}

function hideFocusOverlay() {
  const overlay = document.getElementById('focus-overlay');
  if (overlay) {
    overlay.classList.remove('visible');
    console.log('✓ Focus overlay hidden');
  }
}

// ---------------------
// FOCUS MANAGEMENT
// ---------------------

export function updateFocus() {
  if (state.confirmDialog || state.isAsleep) return; // Don't update focus when modal is open or asleep
  
  // clear all highlights
  document.querySelectorAll(".widget, .menu-item")
    .forEach(el => el.classList.remove("selected", "focused"));

  // grid focus
  if (state.focus.type === "grid") {
    const cell = document.querySelector(
      `.widget[data-row="${state.focus.row}"][data-col="${state.focus.col}"]`
    );
    if (cell) cell.classList.add("selected");
  }

  // sidebar focus
  if (state.focus.type === "menu") {
    const items = elements.sidebar.querySelectorAll(".menu-item");
    if (items[state.focus.index]) items[state.focus.index].classList.add("selected");
    
    // expand sidebar when menu is focused
    elements.sidebar.classList.add("expanded");
  } else {
    elements.sidebar.classList.remove("expanded");
  }
  
  // focused widget - check if selectedCell exists before trying to use it
  if (state.selectedCell && state.selectedCell.classList) {
    state.selectedCell.classList.add("focused");
    showFocusOverlay();  // NEW: Show overlay when widget is focused
  } else {
    hideFocusOverlay();  // NEW: Hide overlay when no widget is focused
  }

  // Reset highlight timer when focus changes
  resetHighlightTimer();
}

// ---------------------
// WIDGET COMMUNICATION
// ---------------------

// Send D-pad action to focused widget
export function sendToWidget(action) {
  if (!state.selectedCell) {
    console.log("No widget selected for command:", action);
    return;
  }
  
  // Add safety checks for selectedCell
  if (typeof state.selectedCell.querySelector !== 'function') {
    console.error("selectedCell is not a DOM element:", state.selectedCell);
    // Clear the invalid selectedCell
    setSelectedCell(null);
    hideFocusOverlay();  // NEW: Hide overlay when clearing invalid selection
    return;
  }
  
  const iframe = state.selectedCell.querySelector("iframe");
  if (iframe && iframe.contentWindow) {
    try {
      iframe.contentWindow.postMessage({ action }, "*");
      console.log(`✓ Sent command '${action}' to widget iframe`);
    } catch (error) {
      console.warn("Failed to send message to widget:", error);
    }
  } else {
    console.log(`No iframe found in selected cell for action: ${action}`);
  }
  
  // Reset timer when sending commands to widgets
  resetHighlightTimer();
}

// ---------------------
// NAVIGATION LOGIC
// ---------------------

export function moveFocus(dir) {
  if (state.isAsleep || state.confirmDialog) return; // Don't move focus when asleep or in modal
  
  // Reset timer on any navigation input - this should wake up highlights
  resetHighlightTimer();
  
  if (state.selectedCell) {
    // Widget is focused — send input there
    sendToWidget(dir);
    return;
  }

  if (state.focus.type === "grid") {
    let { row, col } = state.focus;
    let newRow = row;
    let newCol = col;

    console.log(`BEFORE: ${dir} navigation from (${row},${col})`);

    if (dir === "left") {
      if (col === 1) {
        // Leaving grid → go to sidebar
        const sidebarOptions = [
          { id: "calendar", type: "main", label: "Calendar" },
          { id: "map", type: "main", label: "Location Map" },
          { id: "camera", type: "main", label: "Camera Feed" },
          { id: "reload", type: "system", label: "Reload" },
          { id: "sleep", type: "system", label: "Sleep" },
          { id: "settings", type: "system", label: "Settings" },
          { id: "exit", type: "system", label: "Exit" }
        ];
        const currentMainIndex = sidebarOptions.findIndex(item => item.id === state.currentMain);
        setFocus({ type: "menu", index: currentMainIndex >= 0 ? currentMainIndex : 0 });
        updateFocus(); // Call updateFocus here to apply the changes
        return;
      }
      newCol = col - 1;
      if (newCol < 1) newCol = 1; // Clamp to valid range
    }

    if (dir === "right") {
      newCol = col + 1;
      if (newCol > 2) newCol = 2; // Clamp to valid range
    }

    if (dir === "up") {
      newRow = row - 1;
      if (newRow < 1) newRow = 1; // Clamp to valid range
    }

    if (dir === "down") {
      newRow = row + 1;
      if (newRow > 3) newRow = 3; // Clamp to valid range
    }

    console.log(`AFTER: ${dir} navigation to (${newRow},${newCol})`);

    // Special handling for the main spanning widget (calendar at row 2-3, col 1)
    // Always treat the spanning widget as position (2,1) regardless of which half is selected
    if (newCol === 1 && (newRow === 2 || newRow === 3)) {
      newRow = 2; // Always use the top position of the spanning widget
    }

    // Always update focus to maintain highlighting
    setFocus({ type: "grid", row: newRow, col: newCol });
    
    // ALWAYS call updateFocus to ensure highlighting is maintained
    updateFocus();
    return; // Make sure we don't call updateFocus again at the end
  }

  if (state.focus.type === "menu") {
    const sidebarOptions = [
      { id: "calendar", type: "main", label: "Calendar" },
      { id: "map", type: "main", label: "Location Map" },
      { id: "camera", type: "main", label: "Camera Feed" },
      { id: "reload", type: "system", label: "Reload" },
      { id: "sleep", type: "system", label: "Sleep" },
      { id: "settings", type: "system", label: "Settings" },
      { id: "exit", type: "system", label: "Exit" }
    ];

    let { index } = state.focus;

    if (dir === "up") {
      index = Math.max(0, index - 1);
    }

    if (dir === "down") {
      index = Math.min(sidebarOptions.length - 1, index + 1);
    }

    if (dir === "right") {
      // Leave sidebar → go to grid
      setFocus({ type: "grid", row: 2, col: 1 });
      updateFocus(); // Call updateFocus here to apply the changes
      return;
    }

    setFocus({ type: "menu", index });
  }

  updateFocus();
}

// Handle Enter key for selection
export function handleEnter() {
  // Reset timer on Enter
  resetHighlightTimer();
  
  if (state.isAsleep || state.confirmDialog) return;

  if (state.focus.type === "grid") {
    // findWidget returns the widget config object, we need the actual DOM element
    const widgetConfig = findWidget(state.focus.row, state.focus.col);
    console.log(`Enter pressed on grid position (${state.focus.row},${state.focus.col}), found widget config:`, widgetConfig);
    
    if (widgetConfig) {
      // Find the actual DOM element using the grid position
      const widgetElement = document.querySelector(
        `.widget[data-row="${state.focus.row}"][data-col="${state.focus.col}"]`
      );
      console.log(`Found widget DOM element:`, widgetElement);
      
      if (widgetElement && widgetElement.classList) {
        setSelectedCell(widgetElement);
        console.log(`Selected widget element:`, widgetElement);
        
        // ADDED: Send focus message to the widget iframe
        const iframe = widgetElement.querySelector("iframe");
        if (iframe && iframe.contentWindow) {
          try {
            iframe.contentWindow.postMessage({ action: "focus" }, "*");
            console.log("✓ Sent 'focus' message to widget iframe");
          } catch (error) {
            console.warn("Failed to send focus message to widget:", error);
          }
        }
        
        updateFocus();
      } else {
        console.warn(`No valid widget DOM element found at position (${state.focus.row},${state.focus.col})`);
      }
    } else {
      console.warn(`No widget config found at position (${state.focus.row},${state.focus.col})`);
    }
  }

  if (state.focus.type === "menu") {
    const sidebarOptions = [
      { id: "calendar", type: "main", label: "Calendar" },
      { id: "map", type: "main", label: "Location Map" },
      { id: "camera", type: "main", label: "Camera Feed" },
      { id: "reload", type: "system", label: "Reload" },
      { id: "sleep", type: "system", label: "Sleep" },
      { id: "settings", type: "system", label: "Settings" },
      { id: "exit", type: "system", label: "Exit" }
    ];

    const selectedOption = sidebarOptions[state.focus.index];
    if (selectedOption && selectedOption.id) {
      handleMenuSelection(selectedOption.id);
    }
  }
}

// Handle Escape/Back key
export function handleBack() {
  console.log('🔙 handleBack called');
  console.log('  state.selectedCell:', state.selectedCell);
  console.log('  state.isAsleep:', state.isAsleep);
  console.log('  state.confirmDialog:', state.confirmDialog);
  
  if (state.isAsleep || state.confirmDialog) return;

  if (state.selectedCell) {
    console.log('  ✓ Widget is focused, defocusing...');
    
    // Send escape to widget before defocusing so it can clean up
    const iframe = state.selectedCell.querySelector("iframe");
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ action: "escape" }, "*");
        console.log("  ✓ Sent 'escape' to widget");
      } catch (error) {
        console.warn("  ⚠️ Failed to send escape to widget:", error);
      }
    }
    
    // Small delay to let widget process the escape, then defocus
    setTimeout(() => {
      console.log('  🔄 Clearing selection...');
      setSelectedCell(null);
      console.log('    selectedCell is now:', state.selectedCell);
      
      hideFocusOverlay();
      
      console.log('  🔄 Calling showHighlights...');
      showHighlights();
      
      console.log('  🔄 Calling updateFocus...');
      updateFocus();
      
      console.log('  ✅ handleBack complete');
    }, 10);
  } else if (state.focus.type === "grid" || state.focus.type === "menu") {
    console.log('  ℹ️ Not focused, hiding highlights');
    hideHighlights();
  }
}

function handleMenuSelection(optionId) {
  console.log(`Menu selection: ${optionId}`);
  
  switch(optionId) {
    case "calendar":
    case "map":
    case "camera":
      // These need to trigger the grid re-rendering with new main widget
      setCurrentMain(optionId);
      
      // Import and call the grid rendering functions
      import('../ui/grid.js').then(({ renderGrid, renderSidebar }) => {
        renderGrid();
        renderSidebar();
        
        // Move focus back to grid and close sidebar
        setFocus({ type: "grid", row: 2, col: 1 });
        elements.sidebar.classList.remove("expanded");
        updateFocus();
        
        console.log(`Switched main widget to: ${optionId}`);
      });
      break;
    case "reload":
      window.location.reload();
      break;
    case "sleep":
      // Import and trigger sleep mode - use correct function name
      import('../ui/modals.js').then(({ enterSleepMode }) => {
        enterSleepMode();
      }).catch(() => {
        console.log("Sleep function not available");
      });
      break;
    case "settings":
      // Import and open settings - use correct function name
      import('../settings/settings-main.js').then(({ showSettings }) => {
        showSettings();
      }).catch(() => {
        console.log("Settings function not available");
      });
      break;
    case "exit":
      // Import and show exit confirmation - use correct function name
      import('../ui/modals.js').then(({ showExitConfirmation }) => {
        showExitConfirmation();
      }).catch(() => {
        console.log("Exit confirmation not available");
      });
      break;
  }
}

// Open menu with current main widget selected
export function openMenuWithCurrentSelection() {
  if (state.isAsleep || state.confirmDialog || state.selectedCell) return; // Don't open menu if widget is focused
  
  const sidebarOptions = [
    { id: "calendar", type: "main", label: "Calendar" },
    { id: "map", type: "main", label: "Location Map" },
    { id: "camera", type: "main", label: "Camera Feed" },
    { id: "reload", type: "system", label: "Reload" },
    { id: "sleep", type: "system", label: "Sleep" },
    { id: "settings", type: "system", label: "Settings" },
    { id: "exit", type: "system", label: "Exit" }
  ];
  
  // Find the index of the currently active main widget
  const currentMainIndex = sidebarOptions.findIndex(item => item.id === state.currentMain);
  setFocus({ type: "menu", index: currentMainIndex >= 0 ? currentMainIndex : 0 });
  elements.sidebar.classList.add("expanded");
  updateFocus();
}

// Initialize highlight system
export function initializeHighlightTimeout() {
  // Start with highlights hidden (clean dashboard on startup)
  isHighlightVisible = false;
  document.body.classList.add('highlights-hidden');
  
  // DON'T call resetHighlightTimer here - let the first navigation input show highlights
  
  console.log("Navigation highlight timeout system initialized - starting with hidden highlights");
}