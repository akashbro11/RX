const axios = require("axios");
const { getPrefix } = global.utils;
const { commands, aliases } = global.GoatBot;


// ===== Video API (random video every time) =====
// NOTE: ফাইলের নাম (video.json) আপনার repo অনুযায়ী বদলে নিন
const VIDEO_API = "https://raw.githubusercontent.com/Alvee-Evan-telegrame-bot/rv-api/main/video.json";
const FALLBACK_VIDEO = "https://files.catbox.moe/uoljwh.mp4";
let videoList = null;

async function getRandomVideo() {
 try {
 if (!videoList) {
 const res = await axios.get(VIDEO_API);
 let data = res.data;
 if (typeof data === "string") data = JSON.parse(data);
 if (!Array.isArray(data)) data = data.videos || data.data || Object.values(data);
 videoList = data
 .map(v => (typeof v === "string" ? v : v.url || v.video || v.link))
 .filter(Boolean);
 }
 if (!videoList.length) return FALLBACK_VIDEO;
 return videoList[Math.floor(Math.random() * videoList.length)];
 } catch (err) {
 return FALLBACK_VIDEO;
 }
}

// ===== Style settings =====
const CREATOR = "NADIM";
const LINE = "🌸─────────────────🌸";
const BORDER = "🐼🎀━━━━━━━━━━━━━━🎀🐼";
const CMD_EMOJIS = ["🐼", "🎀", "🧸", "🌸", "🦋", "🍓", "💖", "🐰", "🍭", "✨"];
const CATEGORY_EMOJI = {
  ai: "🤖", anime: "🎀", "box chat": "💬", config: "⚙️", "contacts admin": "📞",
  custom: "🎀", economy: "💰", fun: "🎉", "fun & social": "🎀", game: "🎮",
  games: "🎮", image: "🖼️", info: "📖", islamic: "🎀", love: "💕", media: "🎬",
  other: "🎀", owner: "👑", rank: "🏆", software: "🎀", system: "💻",
  tts: "🎀", utility: "🧰", wiki: "🎀"
};

// Mathematical bold font (𝐚𝐛𝐜 𝐀𝐁𝐂 𝟎𝟏𝟐)
function bold(text) {
  return String(text).split("").map(ch => {
    const c = ch.codePointAt(0);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D41A + c - 97);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1D400 + c - 65);
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1D7CE + c - 48);
    return ch;
  }).join("");
}

function getCategoryEmoji(cat) {
  return CATEGORY_EMOJI[cat.toLowerCase()] || "🎀";
}

function categoryBlock(cat, list) {
  let out = `🎀 〔 ${getCategoryEmoji(cat)} ${bold(cat)} 〕 🐼\n`;
  list.sort().forEach((cmd, i) => {
    out += `  ${CMD_EMOJIS[i % CMD_EMOJIS.length]} ${bold(cmd)}\n`;
  });
  out += `${LINE}\n`;
  return out;
}

function footer(total, prefix) {
  return `${BORDER}
🐼 ${bold("Need help with a command?")} 🎀
🎀 ${bold("Use")} ${prefix}${bold("help")} <${bold("command")}> 🐼
${LINE}
🧸 ${bold("Total Commands")}: ${bold(total)} 🎀
⚡ ${bold("Prefix")}: ${prefix} 🐼
👑 ${bold("Creator")}: ${bold(CREATOR)} 💖
${BORDER}`;
}

function levenshteinDistance(a, b) {
 const matrix = Array(b.length + 1).fill(0).map(() => Array(a.length + 1).fill(0));
 for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
 for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
 for (let j = 1; j <= b.length; j++) {
 for (let i = 1; i <= a.length; i++) {
 const cost = a[i - 1] === b[j - 1] ? 0 : 1;
 matrix[j][i] = Math.min(
 matrix[j][i - 1] + 1,
 matrix[j - 1][i] + 1,
 matrix[j - 1][i - 1] + cost
 );
 }
 }
 return matrix[b.length][a.length];
}

function getClosestCommand(name) {
 const lower = name.toLowerCase();
 let best = null, dist = Infinity;
 for (const cmd of commands.keys()) {
 const d = levenshteinDistance(lower, cmd.toLowerCase());
 if (d < dist) {
 dist = d;
 best = cmd;
 }
 }
 return dist <= 3 ? best : null;
}

function roleTextToString(role) {
 switch (role) {
 case 0: return "All Users";
 case 1: return "Group Admins";
 case 2: return "VIP Users";
 case 3: return "Bot Admin";
 case 4: return "Bot Creator";
 default: return "Unknown";
 }
}

module.exports = {
 config: {
 name: "help",
 aliases: "menu",
 version: "2.1",
 author: "rocky404",
 countDown: 5,
 role: 0,
 shortDescription: { en: "Shows all commands or details." },
 longDescription: { en: "Display categories, command lists or specific command info." },
 category: "info",
 guide: { en: "{pn}, {pn} [command], {pn} -c [category]" }
 },

 onStart: async function ({ message, args, event, role }) {
 const prefix = getPrefix(event.threadID);

 const categories = {};
 for (const [name, cmd] of commands) {
 if (!cmd?.config || typeof cmd.onStart !== "function") continue;
 if (cmd.config.role > role) continue;
 const cat = (cmd.config.category || "UNCATEGORIZED").toUpperCase();
 if (!categories[cat]) categories[cat] = [];
 categories[cat].push(name);
 }

 // প্রতিবার help দিলে আলাদা random video
 const helpImage = await getRandomVideo();
 const input = args.join(" ").trim();

 const sendWithVideo = async (body) => {
 try {
 return await message.reply({ body, attachment: await global.utils.getStreamFromURL(helpImage) });
 } catch (e) {
 return message.reply(body);
 }
 };

 if (args[0] === "-c" && args[1]) {
 const categoryName = args.slice(1).join(" ").toUpperCase();
 if (!categories[categoryName]) {
 return message.reply(`❌ Category "${categoryName}" not found.`);
 }
 const list = categories[categoryName];
 let msg = `${BORDER}\n   🎀 ${bold("COMMAND MENU")} 🐼\n${BORDER}\n\n`;
 msg += categoryBlock(categoryName, list) + "\n";
 msg += footer(list.length, prefix);
 return sendWithVideo(msg);
 }

 if (!input) {
 let msg = `${BORDER}\n   🎀 ${bold("COMMAND MENU")} 🐼\n${BORDER}\n\n`;
 for (const cat of Object.keys(categories).sort()) {
 msg += categoryBlock(cat, categories[cat]) + "\n";
 }
 msg += footer(commands.size, prefix);
 return sendWithVideo(msg);
 }

 const cmdName = input.toLowerCase();
 const cmd = commands.get(cmdName) || commands.get(aliases.get(cmdName));

 if (!cmd || !cmd.config) {
 const suggestion = getClosestCommand(cmdName);
 return message.reply(
 suggestion
 ? `❌ Command "${cmdName}" not found.\n👉 Maybe you meant: ${suggestion}`
 : `❌ Command "${cmdName}" not found.`
 );
 }

 const c = cmd.config;
 const usage = c.guide?.en?.replace(/{pn}/g, `${prefix}${c.name}`) || "No usage.";

 const msg = `${BORDER}
   🎀 ${bold("COMMAND INFO")} 🐼
${BORDER}
🐼 ${bold("Name")} : ${c.name}
🎀 ${bold("Category")} : ${(c.category || "UNCATEGORIZED").toUpperCase()}
🧸 ${bold("Description")} : ${c.longDescription?.en || c.shortDescription?.en || "No description."}
🌸 ${bold("Aliases")} : ${c.aliases ? [].concat(c.aliases).join(", ") : "None"}
🦋 ${bold("Version")} : ${c.version || "1.0"}
🍓 ${bold("Permission")} : ${c.role} (${roleTextToString(c.role)})
💖 ${bold("Cooldown")} : ${c.countDown || 5}s
🐰 ${bold("Author")} : ${c.author || "Unknown"}
🍭 ${bold("Usage")} : ${usage}
${BORDER}`;

 return message.reply(msg);
 }
};
