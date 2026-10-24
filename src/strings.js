// UI strings: en (English), zh (简体中文), tw (繁體中文). Game data names come from public/loc/*.json.
const en = {
  title: "ROME II WEB CAMPAIGN EDITOR",
  connect: "Connect folder", change: "Change folder", refresh: "Refresh",
  campaign: "CAMPAIGN", turn: "TURN", player: "PLAYER FACTION", bridge: "BRIDGE", folder: "FOLDER",
  tabs: { map: "MAP", diplomacy: "TREASURY & DIPLOMACY", console: "CONSOLE" },  filterAll: "All factions", settlements: "Settlements", showArmies: "Armies", showNavies: "Navies", showAgents: "Agents",
  resetView: "Reset view",
  mapHint: "Click an army, agent or settlement to edit it · right-click to create an army · wheel to zoom · drag to pan",
  types: { general: "General", admiral: "Admiral", spy: "Spy", dignitary: "Dignitary", champion: "Champion", colonel: "Colonel", politician: "Politician" },
  lord: "Lord", admiral: "Admiral", agent: "Agent", character: "Character", settlement: "Settlement", faction: "Faction", name: "Name",
  typeSubtype: "Type", leader: "faction leader", army: "army", navy: "navy", units: "units", logicalPos: "Logical position (x, y)",
  logicalPosSettlement: "Logical position settlement (x, y)", region: "Region",
  actions: "Actions", addExperience: "Add experience", generalExperience: "General experience", agentExperience: "Agent experience", generalXpHint: "Added to this general. From 0, ranks 2–10 take 8, 24, 48, 80, 120, 168, 224, 288 and 360 experience.", agentXpHint: "Added to this agent. From 0, ranks 2–10 take 8, 24, 48, 80, 120, 168, 224, 288 and 360 experience.",
  unitExperience: "Unit experience", unitXpAmount: "Ranks (chevrons) per unit", unitXpHint: "Applied instantly to every unit in this army. Units top out at rank 9.",
  replenish: "Replenish action points",
  zeroAp: "Zero action points",
  province: "Province", publicOrder: "Public order", publicOrderHint: "Sets public order for this settlement's province to the number entered.", transfer: "Transfer region",
  buildings: "Buildings", emptySlot: "Empty slot",
  repairBuilding: "Repair building",
  develop: "Add population surplus", populationSurplus: "Population surplus", populationSurplusHint: "Adds the number entered to this region's population surplus.", repair: "Repair buildings", rebellion: "Spawn rebellion", owner: "Owner",
  treasury: "Treasury", nationalTreasury: "Treasury", setTo: "Set to", culture: "Culture", regionsCol: "Regions", forcesCol: "Forces",
  human: "Human",
  diplomacy: "Diplomacy",
  factionB: "Faction B", declareWar: "Force war", makePeace: "Force peace", trade: "Force trade agreement",
  vassal: "Force vassalage", vassalHint: "B becomes vassal of this faction",
  send: "Send", rawTitle: "Raw request", rawType: "type", rawArgs: "arguments (JSON)", capabilities: "Available request types",
  log: "Exchange log", noLog: "No requests sent yet.", confirm: "Confirm", cancel: "Cancel", search: "Search…",
  createTitle: "Create army", targetRegion: "Target region", logicalX: "Logical X", logicalY: "Logical Y",
  unitList: "Unit keys (comma separated)", unitPicker: "Choose a unit", unitFilter: "Search by name or key", baseGameOnly: "Base game units only",
  unitAdd: "Add", unitKey: "Unit key", levels: "Levels", points: "Points", dropSea: "That spot is sea or outside the map.",
  needsChromium: "This browser lacks the File System Access API. Use Chrome or Edge.",
  notReady: "Folder selected, but no ready marker from the game yet. Load a campaign with the mod enabled, then refresh.",
  connected: "Connected to the campaign bridge.", notConnected: "Connect the bridge folder first.",
  installTitle: "Setup", install1: "Create the bridge folder:", install2: "Copy release/rome2_web_editor.pack into Rome II/data and enable it in the launcher.",
  install3: "Load a campaign; response.json receives a ready marker.", install4: "Click Connect folder and choose the bridge folder.",
};

const zh = {
  title: "罗马 II 网页战役编辑器",
  connect: "连接文件夹", change: "更换文件夹", refresh: "刷新",
  campaign: "战役", turn: "回合", player: "玩家势力", bridge: "桥接版本", folder: "文件夹",
  tabs: { map: "地图", diplomacy: "国库与外交", console: "控制台" },  filterAll: "全部势力", settlements: "城市", showArmies: "军队", showNavies: "舰队", showAgents: "特工",
  resetView: "重置视图",
  mapHint: "点击军队、特工或城市进行编辑 · 右键创建军队 · 滚轮缩放 · 拖动平移",
  types: { general: "将军", admiral: "舰队指挥", spy: "间谍", dignitary: "政要", champion: "勇士", colonel: "军官", politician: "政治家" },
  lord: "将领", admiral: "舰队指挥", agent: "特工", character: "角色", settlement: "城市", faction: "势力", name: "名称",
  typeSubtype: "类型", leader: "派系领袖", army: "陆军", navy: "海军", units: "单位", logicalPos: "逻辑坐标 (x, y)",
  logicalPosSettlement: "城市逻辑坐标 (x, y)", region: "地区",
  actions: "操作", addExperience: "增加经验", generalExperience: "将军经验", agentExperience: "特工经验", generalXpHint: "加到这位将军身上。从 0 起，2 到 10 级需要的总经验是 8、24、48、80、120、168、224、288、360。", agentXpHint: "加到这位特工身上。从 0 起，2 到 10 级需要的总经验是 8、24、48、80、120、168、224、288、360。",
  unitExperience: "士兵经验", unitXpAmount: "每个单位提升军衔（级）", unitXpHint: "立即作用于这支军队的所有单位。军衔最高 9 级。",
  replenish: "补满行动力",
  zeroAp: "清空行动力",
  province: "行省", publicOrder: "治安", publicOrderHint: "把该城市所在行省的治安设为填入的数值。", transfer: "转移地区",
  buildings: "建筑", emptySlot: "空槽位",
  repairBuilding: "修复此建筑",
  develop: "增加人口盈余", populationSurplus: "人口盈余", populationSurplusHint: "把填入的数量加到该地区的人口盈余上。", repair: "修复建筑", rebellion: "触发叛乱", owner: "所属",
  treasury: "金库", nationalTreasury: "国库", setTo: "设为", culture: "文化", regionsCol: "地区数", forcesCol: "军队数",
  human: "玩家",
  diplomacy: "外交",
  factionB: "势力 B", declareWar: "强制宣战", makePeace: "强制和平", trade: "强制贸易协定",
  vassal: "强制附庸", vassalHint: "B 成为本势力的附庸",
  send: "发送", rawTitle: "原始请求", rawType: "type", rawArgs: "参数 (JSON)", capabilities: "可用请求类型",
  log: "通信日志", noLog: "尚未发送请求。", confirm: "确认", cancel: "取消", search: "搜索…",
  createTitle: "创建军队", targetRegion: "目标地区", logicalX: "逻辑 X", logicalY: "逻辑 Y",
  unitList: "单位 key（逗号分隔）", unitPicker: "选择单位", unitFilter: "按名称或 key 搜索", baseGameOnly: "仅本体兵种",
  unitAdd: "添加", unitKey: "单位 key", levels: "等级数", points: "点数", dropSea: "目标位置是海面或地图外。",
  needsChromium: "当前浏览器不支持 File System Access API，请使用 Chrome 或 Edge。",
  notReady: "已选择文件夹，但游戏尚未写入 ready 标记。请在启用 Mod 的情况下载入战役后再刷新。",
  connected: "已连接到战役桥接。", notConnected: "请先连接桥接文件夹。",
  installTitle: "安装步骤", install1: "创建桥接文件夹：", install2: "把 release/rome2_web_editor.pack 复制到 Rome II/data 并在启动器中启用。",
  install3: "载入战役后 response.json 会出现 ready 标记。", install4: "点击“连接文件夹”并选择该文件夹。",
};

const tw = {
  title: "羅馬 II 網頁戰役編輯器",
  connect: "連接資料夾", change: "更換資料夾", refresh: "重新整理",
  campaign: "戰役", turn: "回合", player: "玩家勢力", bridge: "橋接版本", folder: "資料夾",
  tabs: { map: "地圖", diplomacy: "國庫與外交", console: "主控台" },  filterAll: "全部勢力", settlements: "城市", showArmies: "軍隊", showNavies: "艦隊", showAgents: "特工",
  resetView: "重設視圖",
  mapHint: "點擊軍隊、特工或城市進行編輯 · 右鍵建立軍隊 · 滾輪縮放 · 拖曳平移",
  types: { general: "將軍", admiral: "艦隊指揮", spy: "間諜", dignitary: "政要", champion: "勇士", colonel: "軍官", politician: "政治家" },
  lord: "將領", admiral: "艦隊指揮", agent: "特工", character: "角色", settlement: "城市", faction: "勢力", name: "名稱",
  typeSubtype: "類型", leader: "派系領袖", army: "陸軍", navy: "海軍", units: "單位", logicalPos: "邏輯座標 (x, y)",
  logicalPosSettlement: "城市邏輯座標 (x, y)", region: "地區",
  actions: "操作", addExperience: "增加經驗", generalExperience: "將軍經驗", agentExperience: "特工經驗", generalXpHint: "加到這位將軍身上。從 0 起，2 到 10 級需要的總經驗是 8、24、48、80、120、168、224、288、360。", agentXpHint: "加到這位特工身上。從 0 起，2 到 10 級需要的總經驗是 8、24、48、80、120、168、224、288、360。",
  unitExperience: "士兵經驗", unitXpAmount: "每個單位提升軍階（級）", unitXpHint: "立即作用於這支軍隊的所有單位。軍階最高 9 級。",
  replenish: "補滿行動力",
  zeroAp: "清空行動力",
  province: "行省", publicOrder: "治安", publicOrderHint: "把該城市所在行省的治安設為填入的數值。", transfer: "轉移地區",
  buildings: "建築", emptySlot: "空槽位",
  repairBuilding: "修復此建築",
  develop: "增加人口盈餘", populationSurplus: "人口盈餘", populationSurplusHint: "把填入的數量加到該地區的人口盈餘上。", repair: "修復建築", rebellion: "觸發叛亂", owner: "所屬",
  treasury: "金庫", nationalTreasury: "國庫", setTo: "設為", culture: "文化", regionsCol: "地區數", forcesCol: "軍隊數",
  human: "玩家",
  diplomacy: "外交",
  factionB: "勢力 B", declareWar: "強制宣戰", makePeace: "強制和平", trade: "強制貿易協定",
  vassal: "強制附庸", vassalHint: "B 成為本勢力的附庸",
  send: "送出", rawTitle: "原始請求", rawType: "type", rawArgs: "參數 (JSON)", capabilities: "可用請求類型",
  log: "通訊日誌", noLog: "尚未送出請求。", confirm: "確認", cancel: "取消", search: "搜尋…",
  createTitle: "建立軍隊", targetRegion: "目標地區", logicalX: "邏輯 X", logicalY: "邏輯 Y",
  unitList: "單位 key（逗號分隔）", unitPicker: "選擇單位", unitFilter: "依名稱或 key 搜尋", baseGameOnly: "僅本體兵種",
  unitAdd: "新增", unitKey: "單位 key", levels: "等級數", points: "點數", dropSea: "目標位置是海面或地圖外。",
  needsChromium: "目前瀏覽器不支援 File System Access API，請使用 Chrome 或 Edge。",
  notReady: "已選擇資料夾，但遊戲尚未寫入 ready 標記。請在啟用 Mod 的情況下載入戰役後再重新整理。",
  connected: "已連線到戰役橋接。", notConnected: "請先連接橋接資料夾。",
  installTitle: "安裝步驟", install1: "建立橋接資料夾：", install2: "把 release/rome2_web_editor.pack 複製到 Rome II/data 並在啟動器中啟用。",
  install3: "載入戰役後 response.json 會出現 ready 標記。", install4: "點擊「連接資料夾」並選擇該資料夾。",
};

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh", label: "简体中文" },
  { code: "tw", label: "繁體中文" },
];

const dictionaries = { en, zh, tw };

export function detectLanguage(navigatorLanguage = "") {
  const l = navigatorLanguage.toLowerCase();
  if (l.startsWith("zh-tw") || l.startsWith("zh-hk") || l.startsWith("zh-hant")) return "tw";
  if (l.startsWith("zh")) return "zh";
  return "en";
}

export function createI18n(initial = "en") {
  let lang = dictionaries[initial] ? initial : "en";
  const t = (key) => key.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : undefined), dictionaries[lang])
    ?? key.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : undefined), en)
    ?? key;
  return {
    t,
    get lang() { return lang; },
    set(code) { if (dictionaries[code]) lang = code; return lang; },
  };
}
