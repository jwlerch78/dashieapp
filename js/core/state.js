// js/core/state.js - Global State Management
// CHANGE SUMMARY: Fixed widget URLs to use absolute paths for OAuth callback compatibility

// ---------------------
// APP STATE
// ---------------------

// DOM element references
export const elements = {
  grid: document.getElementById("grid"),
  sidebar: document.getElementById("sidebar")
};

// Widget URL mappings - FIXED: All paths now absolute
export const widgetUrls = {
  // CALENDAR OPTIONS - Switch between these by changing which one is assigned to 'calendar'
  //calendar: "/widgets/calendar/calendar_tui.html",              // ORIGINAL: TUI Calendar widget (backup)       
  calendar: "/widgets/dcal/calendar_dcal.html",              // NEW: Custom Google Calendar-style widget
  
  // OTHER WIDGETS
  clock: "/widgets/clock/clock.html", 
  location: "/widgets/location/location.html",
  map: "/widgets/map/map.html",
  agenda: "/widgets/agenda/agenda.html",
  photos: "/widgets/photos/photos.html",
  camera: "/widgets/camera/camera.html",
  header: "/widgets/header/header.html"
};

// Widget layout configuration
export const widgets = [
  { 
    id: "header", 
    row: 1, col: 1, 
    rowSpan: 1, colSpan: 1, 
    url: widgetUrls.header, 
    noCenter: true,
    focusScale: 1.0
  },
  { 
    id: "clock", 
    row: 1, col: 2, 
    rowSpan: 1, colSpan: 1, 
    url: widgetUrls.clock,
    focusScale: 1.5
  },
  { 
    id: "main", 
    row: 2, col: 1, 
    rowSpan: 2, colSpan: 1, 
    url: widgetUrls.calendar,
    focusScale: 1.2
  },
  { 
    id: "agenda", 
    row: 2, col: 2, 
    rowSpan: 1, colSpan: 1, 
    url: widgetUrls.agenda,
    focusScale: 1.4
  },
  { 
    id: "photos", 
    row: 3, col: 2, 
    rowSpan: 1, colSpan: 1, 
    url: widgetUrls.photos,
    focusScale: 1.4
  }
];

// Map sidebar keys to main widget content
export const sidebarMapping = {
  calendar: "📅 Calendar",
  map: "🗺️ Map",
  camera: "📷 Camera"
};

// Mutable application state
export const state = {
  currentMain: "calendar", // default main widget
  focus: { type: "grid", row: 1, col: 1 }, // current focus for D-pad navigation
  selectedCell: null, // focused widget
  isAsleep: false, // sleep mode state
  confirmDialog: null, // exit confirmation dialog state
  widgetReadyStatus: new Map(), // track which widgets are ready
  
  // Focus menu state
  focusMenuState: {
    active: false,              // Is menu currently visible?
    widgetId: null,             // Which widget's menu ('calendar', 'photos', etc)
    menuConfig: null,           // Menu configuration from widget
    selectedIndex: 0,           // Currently highlighted menu item
    inMenu: true,              // true = navigating menu, false = in widget
    currentSelection: null      // Currently selected item ID
  }
};

// ---------------------
// STATE HELPERS
// ---------------------

export function setFocus(newFocus) {
  state.focus = newFocus;
}

export function setSelectedCell(cell) {
  state.selectedCell = cell;
}

export function setCurrentMain(mainType) {
  state.currentMain = mainType;
  
  // Update the main widget's URL when switching content
  const mainWidget = widgets.find(w => w.id === "main");
  if (mainWidget && widgetUrls[mainType]) {
    mainWidget.url = widgetUrls[mainType];
    mainWidget.label = sidebarMapping[mainType] || mainWidget.label;
  }
}

export function setSleepMode(sleeping) {
  state.isAsleep = sleeping;
}

export function setConfirmDialog(dialog) {
  state.confirmDialog = dialog;
}

export function setWidgetReady(widgetId, ready = true) {
  state.widgetReadyStatus.set(widgetId, ready);
}

export function isWidgetReady(widgetId) {
  return state.widgetReadyStatus.get(widgetId) || false;
}

export function findWidget(row, col) {
  return widgets.find(w => w.row === row && w.col === col);
}

// ---------------------
// FOCUS MENU STATE HELPERS
// ---------------------

export function setFocusMenuActive(widgetId, config) {
  state.focusMenuState = {
    active: true,
    widgetId,
    menuConfig: config,
    selectedIndex: config.defaultIndex || 0,
    inMenu: true,
    currentSelection: config.items[config.defaultIndex || 0]?.id || null
  };
}

export function clearFocusMenuState() {
  state.focusMenuState = {
    active: false,
    widgetId: null,
    menuConfig: null,
    selectedIndex: 0,
    inMenu: true,
    currentSelection: null
  };
}

export function setFocusMenuInWidget(inWidget) {
  state.focusMenuState.inMenu = !inWidget;
}
