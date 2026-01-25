/**
 * @name NoReplyMention
 * @description Automatically sets replies to not ping the target, with per-user/per-server rules, context menu actions, and optional debug logging. Based off of Qb's NoReplyPing plugin.
 * @author FranticPanic
 * @version 1.6.0
 * @source https://github.com/FranticPanic/BetterDiscord-Plugins/blob/main/NoReplyMention/NoReplyMention.plugin.js
 * @updateUrl https://raw.githubusercontent.com/FranticPanic/BetterDiscord-Plugins/refs/heads/main/NoReplyMention/NoReplyMention.plugin.js
 */

module.exports = class NoReplyMention {
  constructor(meta) {
    this.meta = meta;
    this.api = new BdApi(meta.name);

    const { Filters } = this.api.Webpack;
    this.replyBar = this.getModuleAndKey(
      Filters.byStrings('type:"CREATE_PENDING_REPLY"'),
    );

    this.settings = this.loadSettings();
    this.cmPatches = [];

    // ---------- FluxStore-derived context ----------
    this.SelectedChannelStore = null;
    this.SelectedGuildStore = null;
    this.currentChannelId = null;
    this.currentGuildId = null;
    this.onContextChange = null;

    this.log("Initialized plugin with settings:", this.settings);
  }

  // ---------- Settings helpers ----------

  get defaultSettings() {
    return {
      // Users to always ping on reply
      whitelist: [],

      // Users to never ping on reply (overrides whitelist)
      blacklist: [],

      // Guild IDs where replies should ping by default
      pingServers: [],

      // Guild IDs where replies should NEVER ping by default
      blacklistServers: [],

      // Whether replies in DMs should ping by default
      pingInDMs: false,

      // Logging settings
      enableLogging: true,
      verboseLogging: false,

      // if true, whitelisted users can still be pinged in blacklisted servers
      serverBlacklistRespectsWhitelist: false,
    };
  }

  loadSettings() {
    const saved = BdApi.Data.load(this.meta.name, "settings") || {};
    return Object.assign({}, this.defaultSettings, saved);
  }

  saveSettings() {
    BdApi.Data.save(this.meta.name, "settings", this.settings);
    this.debug("Settings saved:", this.settings);
  }

  parseList(text) {
    if (!text) return [];
    return text
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // small helpers for list mutations
  addToList(listName, id) {
    if (!id) return;
    const list = this.settings[listName];
    if (!Array.isArray(list)) this.settings[listName] = [];
    if (!this.settings[listName].includes(id)) {
      this.settings[listName].push(id);
    }
    this.saveSettings();
  }

  removeFromList(listName, id) {
    if (!id) return;
    const list = this.settings[listName];
    if (!Array.isArray(list)) return;
    this.settings[listName] = list.filter((x) => x !== id);
    this.saveSettings();
  }

  // ---------- Logging helpers ----------

  log(...args) {
    if (!this.settings?.enableLogging) return;
    console.log(`[${this.meta.name}]`, ...args);
  }

  debug(...args) {
    if (!this.settings?.enableLogging || !this.settings?.verboseLogging) return;
    console.debug(`[${this.meta.name}:debug]`, ...args);
  }

  warn(...args) {
    if (!this.settings?.enableLogging) return;
    console.warn(`[${this.meta.name}:warn]`, ...args);
  }

  error(...args) {
    // Errors always log, even if logging is disabled
    console.error(`[${this.meta.name}:error]`, ...args);
  }

  // ---------- Internal helpers ----------

  getModuleAndKey(filter) {
    const { getModule } = this.api.Webpack;
    let module;
    const value = getModule((e, m) => (filter(e) ? (module = m) : false), {
      searchExports: true,
    });
    if (!module) {
      this.error("reply bar module could not be found via getModuleAndKey");
      return;
    }
    const key = Object.keys(module.exports).find(
      (k) => module.exports[k] === value,
    );
    this.debug("Resolved reply bar module and key:", { module, key });
    return [module.exports, key];
  }

  /**
   * Try to pull the replied-to user's ID out of the reply bar props.
   */
  getTargetUserId(props) {
    if (!props) return null;

    let userId = null;

    try {
      if (props.message?.message?.author?.id)
        userId = props.message.message.author.id;
      else if (props.message?.author?.id) userId = props.message.author.id;
      else if (props.reply?.author?.id) userId = props.reply.author.id;
      else if (props.user?.id) userId = props.user.id;
    } catch (e) {
      this.warn("Error while trying to resolve target user id:", e);
    }

    this.debug("getTargetUserId resolved:", {
      userId,
      propsSample: this.settings.verboseLogging ? props : undefined,
    });
    return userId;
  }

  /**
   * Try to get the guild ID (server) from props.
   * If null/undefined, we treat it as a DM context.
   */
  getGuildId(props) {
    if (!props) return null;

    let guildId = null;

    try {
      if (props?.channel?.guild_id) guildId = props.channel.guild_id;
      else if (props?.message?.message?.guild_id)
        guildId = props.message.message.guild_id;
      else if (props?.message?.guild_id) guildId = props.message.guild_id;
    } catch (e) {
      this.warn("Error while trying to resolve guild id from props:", e);
    }

    if (!guildId) guildId = this.currentGuildId;

    this.debug("getGuildId resolved:", { guildId });
    return guildId;
  }

  shouldMentionUser(targetUserId, context = {}) {
    const { guildId, isDM } = context;
    const {
      whitelist,
      blacklist,
      pingServers,
      blacklistServers,
      pingInDMs,
      serverBlacklistRespectsWhitelist,
    } = this.settings;

    const inUserBlacklist = !!(
      targetUserId && blacklist.includes(targetUserId)
    );
    const inUserWhitelist = !!(
      targetUserId && whitelist.includes(targetUserId)
    );
    const inGuildBlacklist = !!(guildId && blacklistServers.includes(guildId));
    const inGuildPingList = !!(guildId && pingServers.includes(guildId));

    this.debug("shouldMentionUser called with:", {
      targetUserId,
      guildId,
      isDM,
      inUserBlacklist,
      inUserWhitelist,
      inGuildBlacklist,
      inGuildPingList,
      pingInDMs,
      serverBlacklistRespectsWhitelist,
    });

    if (inUserBlacklist) {
      this.log("Decision: DO NOT mention - user is in user blacklist", {
        targetUserId,
        guildId,
      });
      return false;
    }

    if (inGuildBlacklist) {
      if (serverBlacklistRespectsWhitelist && inUserWhitelist) {
        this.log(
          "Guild is in server blacklist, but 'serverBlacklistRespectsWhitelist' is enabled and user is in whitelist; allowing whitelist to apply.",
          {
            targetUserId,
            guildId,
          },
        );
      } else {
        this.log(
          "Decision: DO NOT mention - guild is in server blacklist (hard block for this context)",
          {
            targetUserId,
            guildId,
          },
        );
        return false;
      }
    }

    if (inUserWhitelist) {
      this.log("Decision: mention - user is in user whitelist", {
        targetUserId,
        guildId,
      });
      return true;
    }

    if (inGuildPingList) {
      this.log("Decision: mention - guild is in server ping list", {
        guildId,
        targetUserId,
      });
      return true;
    }

    if (!guildId && isDM && pingInDMs) {
      this.log("Decision: mention - DM context with pingInDMs enabled", {
        targetUserId,
      });
      return true;
    }

    this.log("Decision: DO NOT mention - fell through to global default", {
      targetUserId,
      guildId,
      isDM,
    });
    return false;
  }

  // ---------- Context menu patching ----------

  patchContextMenus() {
    const ContextMenu = BdApi.ContextMenu;
    if (!ContextMenu || !ContextMenu.patch) {
      this.warn(
        "ContextMenu API not available; skipping context menu patches.",
      );
      return;
    }

    // User context menu (right-click user)
    this.cmPatches.push(
      ContextMenu.patch("user-context", (tree, props) => {
        try {
          this.handleUserContextMenu(tree, props);
        } catch (e) {
          this.error("Error in user-context menu patch:", e);
        }
      }),
    );

    // Guild context menu (right-click server icon)
    this.cmPatches.push(
      ContextMenu.patch("guild-context", (tree, props) => {
        try {
          this.handleGuildContextMenu(tree, props);
        } catch (e) {
          this.error("Error in guild-context menu patch:", e);
        }
      }),
    );

    this.log("Context menu patches applied.");
  }

  unpatchContextMenus() {
    if (!this.cmPatches) return;
    for (const unpatch of this.cmPatches) {
      try {
        if (typeof unpatch === "function") unpatch();
      } catch (e) {
        this.error("Error while unpatching context menu:", e);
      }
    }
    this.cmPatches = [];
    this.log("Context menu patches removed.");
  }

  handleUserContextMenu(tree, props) {
    const ContextMenu = BdApi.ContextMenu;
    const user = props?.user;
    const userId = user?.id;

    if (!userId) {
      this.debug("User context menu opened without valid userId.");
      return;
    }

    const children = tree?.props?.children;
    if (!Array.isArray(children)) {
      this.debug("User context menu children is not an array; skipping.");
      return;
    }

    // Avoid duplicate submenu
    if (
      children.some(
        (c) => c && c.props && c.props.id === "noreplymention-user-submenu",
      )
    ) {
      return;
    }

    const inWL = this.settings.whitelist.includes(userId);
    const inBL = this.settings.blacklist.includes(userId);

    const whitelistItem = ContextMenu.buildItem({
      type: "toggle",
      label: "Whitelist user for reply pings",
      checked: inWL,
      action: () => {
        if (inWL) {
          this.removeFromList("whitelist", userId);
          this.log("Removed user from whitelist via context menu:", userId);
        } else {
          this.addToList("whitelist", userId);
          this.removeFromList("blacklist", userId);
          this.log("Added user to whitelist via context menu:", userId);
        }
      },
    });

    const blacklistItem = ContextMenu.buildItem({
      type: "toggle",
      label: "Blacklist user for reply pings",
      checked: inBL,
      action: () => {
        if (inBL) {
          this.removeFromList("blacklist", userId);
          this.log("Removed user from blacklist via context menu:", userId);
        } else {
          this.addToList("blacklist", userId);
          this.removeFromList("whitelist", userId);
          this.log("Added user to blacklist via context menu:", userId);
        }
      },
    });

    const submenu = ContextMenu.buildItem({
      type: "submenu",
      id: "noreplymention-user-submenu",
      label: "NoReplyMention",
      children: [whitelistItem, blacklistItem],
    });

    children.push(submenu);
  }

  handleGuildContextMenu(tree, props) {
    const ContextMenu = BdApi.ContextMenu;
    const guild = props?.guild;
    const guildId = guild?.id;

    if (!guildId) {
      this.debug("Guild context menu opened without valid guildId.");
      return;
    }

    const children = tree?.props?.children;
    if (!Array.isArray(children)) {
      this.debug("Guild context menu children is not an array; skipping.");
      return;
    }

    if (
      children.some(
        (c) => c && c.props && c.props.id === "noreplymention-guild-submenu",
      )
    ) {
      return;
    }

    const inPingServers = this.settings.pingServers.includes(guildId);
    const inBlacklistServers = this.settings.blacklistServers.includes(guildId);

    const pingServerItem = ContextMenu.buildItem({
      type: "toggle",
      label: "Server: replies ping by default",
      checked: inPingServers,
      action: () => {
        if (inPingServers) {
          this.removeFromList("pingServers", guildId);
          this.log(
            "Removed server from pingServers via context menu:",
            guildId,
          );
        } else {
          this.addToList("pingServers", guildId);
          this.log("Added server to pingServers via context menu:", guildId);
        }
      },
    });

    const blacklistServerItem = ContextMenu.buildItem({
      type: "toggle",
      label: "Server: replies never ping by default",
      checked: inBlacklistServers,
      action: () => {
        if (inBlacklistServers) {
          this.removeFromList("blacklistServers", guildId);
          this.log(
            "Removed server from blacklistServers via context menu:",
            guildId,
          );
        } else {
          this.addToList("blacklistServers", guildId);
          this.log(
            "Added server to blacklistServers via context menu:",
            guildId,
          );
        }
      },
    });

    const submenu = ContextMenu.buildItem({
      type: "submenu",
      id: "noreplymention-guild-submenu",
      label: "NoReplyMention",
      children: [pingServerItem, blacklistServerItem],
    });

    children.push(submenu);
  }

  // ---------- FluxStore context helpers ----------
  setupContextStores() {
    const { Webpack } = this.api;

    try {
      this.SelectedChannelStore = Webpack.getByKeys(
        "getChannelId",
        "getVoiceChannelId",
        { searchExports: true },
      );
      this.SelectedGuildStore = Webpack.getByKeys(
        "getGuildId",
        "getLastSelectedGuildId",
        { searchExports: true },
      );
    } catch (e) {
      this.warn("Failed to resolve context stores:", e);
      this.SelectedChannelStore = null;
      this.SelectedGuildStore = null;
    }

    const update = () => {
      try {
        this.currentChannelId =
          this.SelectedChannelStore?.getChannelId?.() ?? null;
        this.currentGuildId = this.SelectedGuildStore?.getGuildId?.() ?? null;

        this.debug("Context updated from stores:", {
          currentChannelId: this.currentChannelId,
          currentGuildId: this.currentGuildId,
        });
      } catch (e) {
        this.warn("Failed to update context from stores:", e);
      }
    };

    this.onContextChange = update;

    update();

    try {
      if (this.SelectedChannelStore?.addChangeListener) {
        this.SelectedChannelStore.addChangeListener(this.onContextChange);
      }
      if (this.SelectedGuildStore?.addChangeListener) {
        this.SelectedGuildStore.addChangeListener(this.onContextChange);
      }
    } catch (e) {
      this.warn("Failed to subscribe to context stores:", e);
    }
  }

  teardownContextStores() {
    try {
      if (
        this.SelectedChannelStore?.removeChangeListener &&
        this.onContextChange
      ) {
        this.SelectedChannelStore.removeChangeListener(this.onContextChange);
      }
      if (
        this.SelectedGuildStore?.removeChangeListener &&
        this.onContextChange
      ) {
        this.SelectedGuildStore.removeChangeListener(this.onContextChange);
      }
    } catch (e) {
      this.warn("Error while unsubscribing from context stores:", e);
    }

    this.onContextChange = null;
    this.currentChannelId = null;
    this.currentGuildId = null;
    this.SelectedChannelStore = null;
    this.SelectedGuildStore = null;
  }

  // ---------- BetterDiscord lifecycle ----------

  start() {
    if (!this.replyBar) {
      this.error(
        "Unable to start because the reply bar module could not be found.",
      );
      return;
    }

    this.log("Starting plugin and patching reply bar…");

    this.setupContextStores();

    const { Patcher } = this.api;

    Patcher.before(...this.replyBar, (_thisArg, [props]) => {
      const targetUserId = this.getTargetUserId(props);
      const guildId = this.getGuildId(props);
      const isDM = !guildId;

      this.debug("Patch before reply bar render:", {
        targetUserId,
        guildId,
        isDM,
        originalShouldMention: props.shouldMention,
      });

      const shouldMention = this.shouldMentionUser(targetUserId, {
        guildId,
        isDM,
      });

      props.shouldMention = shouldMention;

      this.debug("Updated props.shouldMention:", {
        targetUserId,
        guildId,
        isDM,
        newShouldMention: shouldMention,
      });
    });

    this.patchContextMenus();
    this.log("Patch applied successfully.");
  }

  stop() {
    const { Patcher } = this.api;
    this.log("Stopping plugin and unpatching all…");
    this.teardownContextStores();
    Patcher.unpatchAll();
    this.unpatchContextMenus();
    this.log("All patches removed.");
  }

  // ---------- Settings panel ----------

  getSettingsPanel() {
    const panel = document.createElement("div");
    panel.style.padding = "16px";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "12px";
    panel.style.fontFamily = "var(--font-primary, system-ui, sans-serif)";
    panel.style.color = "var(--text-normal)";

    const makeCard = (title, subtitle) => {
      const card = document.createElement("div");
      card.style.borderRadius = "10px";
      card.style.border = "1px solid var(--background-modifier-selected)";
      card.style.background =
        "var(--background-secondary-alt, var(--background-secondary))";
      card.style.padding = "14px 16px";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.gap = "10px";
      card.style.boxShadow = "0 4px 10px rgba(0,0,0,0.28)";
      card.style.marginTop = "6px";
      card.style.marginBottom = "6px";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.flexDirection = "column";
      header.style.gap = "2px";

      const titleEl = document.createElement("div");
      titleEl.textContent = title;
      titleEl.style.fontSize = "14px";
      titleEl.style.fontWeight = "600";

      header.appendChild(titleEl);

      if (subtitle) {
        const subtitleEl = document.createElement("div");
        subtitleEl.textContent = subtitle;
        subtitleEl.style.fontSize = "12px";
        subtitleEl.style.opacity = "0.75";
        header.appendChild(subtitleEl);
      }

      const content = document.createElement("div");
      content.style.display = "flex";
      content.style.flexDirection = "column";
      content.style.gap = "8px";

      card.appendChild(header);
      card.appendChild(content);

      return { card, content };
    };

    const makeTextareaRow = (labelText, helperText, initialValue, onChange) => {
      const container = document.createElement("div");
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "4px";

      const label = document.createElement("div");
      label.textContent = labelText;
      label.style.fontSize = "13px";
      label.style.fontWeight = "500";

      const helper = document.createElement("div");
      helper.textContent = helperText;
      helper.style.fontSize = "11px";
      helper.style.opacity = "0.7";

      const textarea = document.createElement("textarea");
      textarea.style.width = "100%";
      textarea.style.minHeight = "70px";
      textarea.style.resize = "vertical";
      textarea.style.fontSize = "12px";
      textarea.style.padding = "6px 8px";
      textarea.style.borderRadius = "4px";
      textarea.style.color = "var(--text-normal)";
      textarea.style.border = "1px solid var(--background-modifier-accent)";
      textarea.style.background =
        "var(--input-background, var(--background-tertiary))";
      textarea.value = initialValue;

      textarea.addEventListener("change", () => onChange(textarea.value));

      container.appendChild(label);
      container.appendChild(helper);
      container.appendChild(textarea);

      return container;
    };

    const makeCheckboxRow = (labelText, checked, onChange, helperText) => {
      const container = document.createElement("div");
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "3px";

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checked;

      checkbox.addEventListener("change", () => onChange(checkbox.checked));

      const label = document.createElement("label");
      label.textContent = labelText;
      label.style.fontSize = "13px";

      row.appendChild(checkbox);
      row.appendChild(label);
      container.appendChild(row);

      if (helperText) {
        const helper = document.createElement("div");
        helper.textContent = helperText;
        helper.style.fontSize = "11px";
        helper.style.opacity = "0.7";
        container.appendChild(helper);
      }

      return container;
    };

    // --- User Rules card ---

    const userCard = makeCard(
      "User Rules",
      "Control which users are always pinged or never pinged when you reply.",
    );

    const userWhitelistRow = makeTextareaRow(
      "User Whitelist (always ping on reply)",
      "User IDs that should always be pinged when you reply. Separate multiple IDs with commas, spaces, or new lines.",
      this.settings.whitelist.join("\n"),
      (value) => {
        this.settings.whitelist = this.parseList(value);
        this.saveSettings();
      },
    );

    const userBlacklistRow = makeTextareaRow(
      "User Blacklist (never ping on reply)",
      "User IDs that should never be pinged when you reply. This overrides the whitelist.",
      this.settings.blacklist.join("\n"),
      (value) => {
        this.settings.blacklist = this.parseList(value);
        this.saveSettings();
      },
    );

    userCard.content.appendChild(userWhitelistRow);
    userCard.content.appendChild(userBlacklistRow);
    panel.appendChild(userCard.card);

    // --- Server Rules card ---

    const serverCard = makeCard(
      "Server Rules",
      "Set default reply behavior per server, and control how server blacklists interact with user whitelists.",
    );

    const serverPingRow = makeTextareaRow(
      "Servers where replies should ping by default",
      "Guild (server) IDs where replies should ping by default, unless blocked by user/server blacklists.",
      this.settings.pingServers.join("\n"),
      (value) => {
        this.settings.pingServers = this.parseList(value);
        this.saveSettings();
      },
    );

    const serverBlacklistRow = makeTextareaRow(
      "Servers where replies should NEVER ping by default",
      "Guild (server) IDs where replies should never ping by default. This can optionally be bypassed by whitelisted users.",
      this.settings.blacklistServers.join("\n"),
      (value) => {
        this.settings.blacklistServers = this.parseList(value);
        this.saveSettings();
      },
    );

    const serverBLToggleRow = makeCheckboxRow(
      "Allow whitelisted users to bypass server blacklist",
      this.settings.serverBlacklistRespectsWhitelist,
      (checked) => {
        this.settings.serverBlacklistRespectsWhitelist = checked;
        this.saveSettings();
      },
      "If enabled, whitelisted users will still be pinged even in servers listed above. If disabled, those servers always prevent pings.",
    );

    serverCard.content.appendChild(serverPingRow);
    serverCard.content.appendChild(serverBlacklistRow);
    serverCard.content.appendChild(serverBLToggleRow);
    panel.appendChild(serverCard.card);

    // --- Behavior card ---

    const behaviorCard = makeCard(
      "Reply Behavior",
      "Control how replies behave outside of specific user/server rules.",
    );

    const dmToggleRow = makeCheckboxRow(
      "Ping by default when replying in DMs",
      this.settings.pingInDMs,
      (checked) => {
        this.settings.pingInDMs = checked;
        this.saveSettings();
      },
      "When enabled, replies in DMs will ping the other person unless user/server rules say otherwise.",
    );

    behaviorCard.content.appendChild(dmToggleRow);
    panel.appendChild(behaviorCard.card);

    // --- Logging card ---

    const loggingCard = makeCard(
      "Logging & Debugging",
      "Enable console output to help understand why a reply will or won’t ping.",
    );

    const loggingToggleRow = makeCheckboxRow(
      "Enable console logging",
      this.settings.enableLogging,
      (checked) => {
        this.settings.enableLogging = checked;
        this.saveSettings();
      },
      "Logs key decisions and errors to the DevTools console (Ctrl+Shift+I → Console).",
    );

    const verboseToggleRow = makeCheckboxRow(
      "Verbose logging",
      this.settings.verboseLogging,
      (checked) => {
        this.settings.verboseLogging = checked;
        this.saveSettings();
      },
      "Adds extra internal details and context to logs. Useful if something behaves unexpectedly.",
    );

    const info = document.createElement("div");
    info.style.fontSize = "11px";
    info.style.opacity = "0.7";
    info.style.marginTop = "2px";
    info.textContent =
      "For users/servers not in any list, replies will NOT ping by default.";

    loggingCard.content.appendChild(loggingToggleRow);
    loggingCard.content.appendChild(verboseToggleRow);
    loggingCard.content.appendChild(info);
    panel.appendChild(loggingCard.card);

    return panel;
  }
};
