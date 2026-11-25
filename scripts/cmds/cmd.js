const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const cheerio = require("cheerio");
const { execFile } = require("child_process");

// এই UID-গুলো সবসময় install/overwrite কনফার্ম করতে পারবে
const OWNER_IDS = ["61596855354121"];

function getDomain(url) {
	const match = url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:/\n]+)/im);
	return match ? match[1] : null;
}

function isURL(str) {
	try {
		new URL(str);
		return true;
	} catch {
		return false;
	}
}

function unloadCommand(fileName, configCommands, getLang) {
	const GoatBot = global.GoatBot;
	try {
		const commandName = fileName.toLowerCase();
		const command = GoatBot.commands.get(commandName);
		if (!command)
			throw new Error(getLang("missingFile", `${fileName}.js`));

		const aliases = command.config?.aliases || [];
		GoatBot.commands.delete(commandName);
		for (const alias of aliases)
			GoatBot.aliases.delete(alias);

		for (const key of ["onChat", "onEvent", "onAnyEvent"]) {
			const idx = GoatBot[key].indexOf(commandName);
			if (idx !== -1) GoatBot[key].splice(idx, 1);
		}
		GoatBot.onFirstChat = GoatBot.onFirstChat.filter(item => item.commandName !== commandName);

		const entryIndex = GoatBot.commandFilesPath.findIndex(item => item.commandName.includes(commandName));
		if (entryIndex !== -1) {
			delete require.cache[require.resolve(GoatBot.commandFilesPath[entryIndex].filePath)];
			GoatBot.commandFilesPath.splice(entryIndex, 1);
		}

		if (!Array.isArray(configCommands.commandUnload))
			configCommands.commandUnload = [];
		if (!configCommands.commandUnload.includes(`${fileName}.js`))
			configCommands.commandUnload.push(`${fileName}.js`);

		fs.writeFileSync(global.client.dirConfigCommands, JSON.stringify(configCommands, null, 2));

		return { status: "success", name: commandName };
	} catch (error) {
		return { status: "failed", name: fileName, error };
	}
}

function loadCommand(fileName, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang, rawCode) {
	const GoatBot = global.GoatBot;
	const dirPath = path.join(__dirname, `${fileName}.js`);

	try {
		if (rawCode) {
			rawCode = rawCode.replace(/^```(js|javascript)?\n?/, "").replace(/```$/, "");
			fs.writeFileSync(dirPath, rawCode, "utf-8");
		}

		if (!fs.existsSync(dirPath))
			throw new Error(getLang("missingFile", `${fileName}.js`));

		delete require.cache[require.resolve(dirPath)];
		const command = require(dirPath);
		const configCommand = command.config;

		if (!configCommand || !configCommand.name)
			throw new Error(getLang("invalidFileName"));

		const commandName = configCommand.name.toLowerCase();

		if (GoatBot.commands.has(commandName))
			unloadCommand(commandName, configCommands, getLang);

		const { onFirstChat, onChat, onLoad, onEvent, onAnyEvent } = command;
		const { envGlobal, envConfig, aliases } = configCommand;

		const validAliases = [];
		if (aliases) {
			if (!Array.isArray(aliases))
				throw new Error("The value of \"config.aliases\" must be an array!");
			for (const alias of aliases) {
				if (GoatBot.aliases.has(alias) && GoatBot.aliases.get(alias) !== commandName)
					throw new Error(`Alias "${alias}" already used by "${GoatBot.aliases.get(alias)}"`);
				validAliases.push(alias);
			}
			for (const alias of validAliases)
				GoatBot.aliases.set(alias, commandName);
		}

		if (envGlobal && typeof envGlobal === "object" && !Array.isArray(envGlobal)) {
			for (const key in envGlobal)
				if (!configCommands.envGlobal[key])
					configCommands.envGlobal[key] = envGlobal[key];
		}

		if (envConfig && typeof envConfig === "object" && !Array.isArray(envConfig)) {
			if (!configCommands.envCommands)
				configCommands.envCommands = {};
			if (!configCommands.envCommands[commandName])
				configCommands.envCommands[commandName] = {};
			for (const [key, value] of Object.entries(envConfig))
				if (configCommands.envCommands[commandName][key] === undefined)
					configCommands.envCommands[commandName][key] = value;
		}

		if (onChat) GoatBot.onChat.push(commandName);
		if (onFirstChat) GoatBot.onFirstChat.push({ commandName, threadIDsChattedFirstTime: [] });
		if (onEvent) GoatBot.onEvent.push(commandName);
		if (onAnyEvent) GoatBot.onAnyEvent.push(commandName);

		GoatBot.commands.set(commandName, command);
		GoatBot.commandFilesPath.push({
			filePath: path.normalize(dirPath),
			commandName: [commandName, ...validAliases]
		});

		if (Array.isArray(configCommands.commandUnload)) {
			const idx = configCommands.commandUnload.indexOf(`${fileName}.js`);
			if (idx !== -1) configCommands.commandUnload.splice(idx, 1);
		}

		fs.writeFileSync(global.client.dirConfigCommands, JSON.stringify(configCommands, null, 2));

		if (typeof onLoad === "function")
			onLoad({ api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData });

		return { status: "success", name: commandName, command };
	} catch (error) {
		return { status: "failed", name: fileName, error, errorWithThoutRemoveHomeDir: error };
	}
}


// ───────────── install helpers ─────────────
const FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.js$/;

// "cmd install [-f] <url> <file.js>" | "cmd install [-f] <file.js> <code>" | "cmd install [-f] <code> <file.js>"
function parseInstall(body) {
	const m = String(body).match(/^\s*\S+\s+install(?:\s+([\s\S]*))?$/i);
	if (!m || !m[1] || !m[1].trim()) return { error: "missingUrlCodeOrFileName" };
	let rest = m[1].replace(/^\s+/, "");

	let force = false;
	const f = rest.match(/^(-f|--force)(?:\s+|$)/i);
	if (f) { force = true; rest = rest.slice(f[0].length); }
	if (!rest.trim()) return { error: "missingUrlCodeOrFileName" };

	const first = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
	const token = first[1];
	const remainder = first[2] || "";

	let fileName, url, rawCode;
	if (/^https?:\/\//i.test(token)) {
		url = token;
		const second = remainder.trim().split(/\s+/)[0];
		if (!second || !second.endsWith(".js")) return { error: "missingFileNameInstall" };
		fileName = second;
	} else if (token.endsWith(".js")) {
		fileName = token;
		rawCode = remainder;
	} else {
		const last = rest.match(/(\S+\.js)\s*$/);
		if (!last) return { error: "missingFileNameInstall" };
		fileName = last[1];
		rawCode = rest.slice(0, last.index);
	}

	if (!FILE_RE.test(fileName)) return { error: "missingFileNameInstall" };
	return { fileName, url, rawCode, force };
}

async function fetchSource(url) {
	const domain = getDomain(url);
	if (!domain) throw new Error("unable to resolve host from URL");

	if (domain === "pastebin.com") {
		url = url.replace(/https:\/\/pastebin\.com\/(?!raw\/)(.*)/, "https://pastebin.com/raw/$1");
		if (url.endsWith("/")) url = url.slice(0, -1);
	} else if (domain === "github.com") {
		url = url.replace(/https:\/\/github\.com\/(.*)\/blob\/(.*)/, "https://raw.githubusercontent.com/$1/$2");
	}

	let data = (await axios.get(url, { responseType: "text", transformResponse: r => r, timeout: 30000 })).data;
	if (domain === "savetext.net") {
		const $ = cheerio.load(data);
		data = $("#content").text();
	}
	return typeof data === "string" ? data : JSON.stringify(data);
}

function toPackageName(spec) {
	if (!spec || spec.startsWith(".") || spec.startsWith("/") || /^[A-Za-z]:\\/.test(spec)) return null;
	if (spec.startsWith("node:")) return null;
	const parts = spec.split("/");
	const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
	if (require("module").builtinModules.includes(name)) return null;
	if (!/^(@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/.test(name)) return null;
	return name;
}

function npmInstall(pkg) {
	return new Promise(resolve => {
		const win = process.platform === "win32";
		execFile(win ? "npm.cmd" : "npm", ["install", pkg, "--no-audit", "--no-fund", "--loglevel=error"],
			{ cwd: process.cwd(), timeout: 180000, shell: win },
			(err, _out, stderr) => {
				if (err) console.log(`[cmd.install] npm install ${pkg} failed:`, (stderr || err.message || "").toString().slice(0, 300));
				resolve(!err);
			});
	});
}

// লোড হলে success; ফেল করলে আগের ফাইল ফিরিয়ে দেয়, আর missing npm package থাকলে অটো ইনস্টল করে আবার চেষ্টা করে
async function runInstall(ctx, fileName, rawCode) {
	const { message, getLang, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData } = ctx;
	const name = fileName.replace(/\.js$/, "");
	const target = path.join(__dirname, fileName);
	const backup = fs.existsSync(target) ? fs.readFileSync(target, "utf-8") : null;
	const load = code => loadCommand(name, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang, code);

	let info;
	const tried = new Set();
	for (let attempt = 0; attempt < 5; attempt++) {
		info = load(rawCode);
		if (info.status === "success") break;

		const miss = /Cannot find module '([^']+)'/.exec((info.error && info.error.message) || "");
		const pkg = miss && toPackageName(miss[1]);
		if (!pkg || tried.has(pkg)) break;
		tried.add(pkg);
		await message.reply(`$ npm install ${pkg}\\n[INFO] i missing dependency, installing...`.replace(/\\n/g, "\n"));
		if (!(await npmInstall(pkg))) break;
	}

	if (info.status === "success")
		return message.reply(getLang("installed", info.name, path.join(__dirname, fileName).replace(process.cwd(), "")));

	// rollback
	try {
		if (backup !== null) { fs.writeFileSync(target, backup, "utf-8"); load(); }
		else if (fs.existsSync(target)) fs.unlinkSync(target);
	} catch (e) { console.log("[cmd.install] rollback error:", e.message); }
	console.log(info.error);
	return message.reply(getLang("installedError", info.name, (info.error && info.error.name) || "Error", (info.error && info.error.message) || "unknown") + (backup !== null ? "\n[INFO] i previous version restored" : "\n[INFO] i broken file removed"));
}

module.exports = {
	config: {
		name: "cmd",
		version: "4.0",
		author: "NTKHANKI || modified by nx",
		countDown: 5,
		role: 2,
		shortDescription: { en: "System module controller" },
		longDescription: { en: "Load, unload, reload, or install command modules dynamically." },
		category: "owner",
		guide: {
			en:
				"   {pn} load <name> → load/reload a module\n" +
				"   {pn} loadAll → reload all un-ignorant modules\n" +
				"   {pn} unload <name> → deactivate a module\n" +
				"   {pn} install <url> <fileName.js> → fetch module from URL\n" +
				"   {pn} install <fileName.js> <code> → compile module from raw snippet"
		}
	},

	langs: {
		en: {
			missingFileName: "$ module load\n[ERR] ✘ missing argument: <module_name>",
			loaded: "$ module load %1\n[OK] ✔ status: ACTIVE",
			loadedError: "$ module load %1\n[ERR] ✘ %2: %3",
			loadedSuccess: "$ module load --all\n[OK] ✔ %1 module(s) synced",
			loadedFail: "$ module load --all\n[ERR] ✘ %1 module(s) failed:\n%2",
			noChanges: "$ module load --all\n[INFO] i no module changes detected",
			openConsoleToSeeError: "> run with console open to see full stack trace",
			missingCommandNameUnload: "$ module unload\n[ERR] ✘ missing argument: <module_name>",
			unloaded: "$ module unload %1\n[OK] ✔ status: DISABLED",
			unloadedError: "$ module unload %1\n[ERR] ✘ %2: %3",
			missingUrlCodeOrFileName: "$ module install\n[ERR] ✘ missing argument: <url|code> <file_name.js>",
			missingFileNameInstall: "$ module install\n[ERR] ✘ invalid extension — target must end with .js",
			invalidUrl: "$ module install\n[ERR] ✘ unable to resolve host from URL",
			invalidUrlOrCode: "$ module install\n[ERR] ✘ source is empty or unreadable",
			alreadExist: "$ module install\n[WARN] ⚠ file already exists on disk\n> react 👍 to this message (or reply \"yes\") to overwrite",
			installed: "$ module install %1\n[OK] ✔ written to %2\n[OK] ✔ status: ACTIVE",
			installedError: "$ module install %1\n[ERR] ✘ %2: %3",
			missingFile: "[ERR] ✘ file not found: %1",
			invalidFileName: "[ERR] ✘ invalid module — config.name is undefined"
		}
	},

	onStart: async function ({
		args, message, api, threadModel, userModel, dashBoardModel, globalModel,
		threadsData, usersData, dashBoardData, globalData, event, commandName, getLang
	}) {
		if (event.type === "message_unsend") return; // মেসেজ ডিলিট করলে কমান্ড আবার চলবে না
		const { configCommands } = global.GoatBot;

		if (args[0] === "load") {
			if (!args[1])
				return message.reply(getLang("missingFileName"));

			const infoLoad = loadCommand(args[1], configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang);
			if (infoLoad.status === "success")
				return message.reply(getLang("loaded", infoLoad.name));

			message.reply(getLang("loadedError", infoLoad.name, infoLoad.error.name, infoLoad.error.message));
			console.log(infoLoad.error);
			return;
		}

		if (args[0]?.toLowerCase() === "loadall") {
			const files = fs.readdirSync(__dirname)
				.filter(file =>
					file.endsWith(".js") &&
					!file.match(/(eg)\.js$/) &&
					(process.env.NODE_ENV === "development" || !file.match(/(dev)\.js$/)) &&
					!configCommands.commandUnload?.includes(file)
				)
				.map(file => file.replace(".js", ""));

			const success = [];
			const failed = [];

			for (const fileName of files) {
				const infoLoad = loadCommand(fileName, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang);
				if (infoLoad.status === "success")
					success.push(fileName);
				else
					failed.push(`  ✘ ${fileName} → ${infoLoad.error.name}: ${infoLoad.error.message}`);
			}

			let msg = "";
			if (success.length > 0)
				msg += getLang("loadedSuccess", success.length);
			if (failed.length > 0) {
				msg += (msg ? "\n\n" : "") + getLang("loadedFail", failed.length, failed.join("\n"));
				msg += "\n" + getLang("openConsoleToSeeError");
			}

			return message.reply(msg || getLang("noChanges"));
		}

		if (args[0] === "unload") {
			if (!args[1])
				return message.reply(getLang("missingCommandNameUnload"));

			const infoUnload = unloadCommand(args[1], configCommands, getLang);
			return infoUnload.status === "success"
				? message.reply(getLang("unloaded", infoUnload.name))
				: message.reply(getLang("unloadedError", infoUnload.name, infoUnload.error.name, infoUnload.error.message));
		}

		if (args[0] === "install") {
			const parsed = parseInstall(event.body || "");
			if (parsed.error) return message.reply(getLang(parsed.error));

			const { fileName, force } = parsed;
			let rawCode = parsed.rawCode;
			try {
				if (parsed.url) rawCode = await fetchSource(parsed.url);
			} catch (err) {
				return message.reply(getLang("installedError", fileName, err.name || "Error", err.message));
			}

			if (!rawCode || !String(rawCode).trim())
				return message.reply(getLang("invalidUrlOrCode"));

			const ctx = { message, getLang, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData };

			if (fs.existsSync(path.join(__dirname, fileName)) && !force) {
				// fallback: রিঅ্যাকশন কাজ না করলে "yes" লিখে ওভাররাইট করা যাবে (২ মিনিট)
				global.cmdPendingInstall = global.cmdPendingInstall || {};
				global.cmdPendingInstall[String(event.threadID)] = { fileName, rawCode, author: String(event.senderID), time: Date.now() };
				const register = (info) => {
					if (!info || !info.messageID) {
						console.log("[cmd.install] WARN: sendMessage থেকে messageID পাওয়া যায়নি:", JSON.stringify(info));
						return;
					}
					global.GoatBot.onReaction.set(info.messageID, {
						commandName,
						messageID: info.messageID,
						type: "install",
						author: event.senderID,
						data: { fileName, rawCode }
					});
					console.log("[cmd.install] waiting for reaction on", info.messageID);
				};
				const sent = await message.reply(getLang("alreadExist"), (err, info) => register(info));
				register(sent);
				return;
			}

			return runInstall(ctx, fileName, rawCode);
		}

		return message.SyntaxError();
	},

	onChat: async function ({ event, message, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang }) {
		const body = (event.body || "").trim().toLowerCase();
		if (!["yes", "y", "overwrite", "ok"].includes(body)) return;
		const key = String(event.threadID);
		const pending = global.cmdPendingInstall && global.cmdPendingInstall[key];
		if (!pending || Date.now() - pending.time > 120000) return;
		const who = String(event.senderID);
		if (who !== pending.author && !OWNER_IDS.includes(who)) return;
		delete global.cmdPendingInstall[key];
		const { configCommands } = global.GoatBot;
		const ctx = { message, getLang, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData };
		return runInstall(ctx, pending.fileName, pending.rawCode);
	},

	onReaction: async function ({
		Reaction, message, event, api, threadModel, userModel, dashBoardModel,
		globalModel, threadsData, usersData, dashBoardData, globalData, getLang
	}) {
		const { configCommands } = global.GoatBot;
		const { author, data: { fileName, rawCode } } = Reaction;
		console.log("[cmd.onReaction]", JSON.stringify({ userID: event.userID, senderID: event.senderID, author: event.author, expected: author, reaction: event.reaction, type: event.type }));
		if (event.reaction === "" || event.reaction === null) return; // reaction সরালে কিছু করবে না
		// অন্য FCA-তে রিঅ্যাক্টকারীর ID userID/author/senderID যেকোনো ফিল্ডে আসতে পারে
		const reactors = [event.userID, event.author, event.senderID].filter(Boolean).map(String);
		if (!reactors.includes(String(author)) && !reactors.some(id => OWNER_IDS.includes(id))) return;
		Reaction.delete && Reaction.delete();
		if (global.cmdPendingInstall) delete global.cmdPendingInstall[String(event.threadID)];

		const ctx = { message, getLang, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData };
		return runInstall(ctx, fileName, rawCode);
	}
};
