// Copyright (c) Michael Corcoran
// SPDX-License-Identifier: MIT

"use strict";

const MF_CAPT = "ws://localhost:8320/winwing/cdu-captain";
const MF_FO = "ws://localhost:8320/winwing/cdu-co-pilot";
const MF_CDU_ROWS = 14;
const MF_CDU_COLS = 24;

const MfCharSize = Object.freeze({
  Large: 0,
  Small: 1,
});

const MfColour = Object.freeze({
  Amber: "a",
  Brown: "o",
  Cyan: "c",
  Green: "g",
  Grey: "e",
  Khaki: "k",
  Magenta: "m",
  Red: "r",
  White: "w",
  Yellow: "y",
});

class Wt21MobiflightCduAvionicsPlugin {
  constructor(binder) {
    this.binder = binder;
    this.socketUri = !!binder.isPrimaryInstrument ? MF_CAPT : MF_FO;
    this.needsUpdate = false;
    this.output = {
      Target: "Display",
      Data: Array.from({ length: MF_CDU_ROWS * MF_CDU_COLS }, () => []),
    };

    this.onSocketErrorHandler = this.onSocketError.bind(this);
    this.connectHandler = this.connect.bind(this);
  }

  onInstalled() {
    console.log("[MF CDU plugin] installed.");
    this.binder.bus
      .getSubscriber()
      .on("simTime")
      .atFrequency(4)
      .handle(this.onUpdate.bind(this));
    Wt21MobiflightCduAvionicsPlugin.isEnabled.sub(
      (v) => (v ? this.connect() : this.disconnect()),
      true
    );
    Wt21MobiflightCduAvionicsPlugin.isShowMsgEnabled.sub(
      () => (this.needsUpdate = true),
      false
    );
  }

  registerFmcExtensions(fmcScreen) {
    this.renderer = fmcScreen.renderer;
    const oldRenderToDom = fmcScreen.renderer.renderToDom.bind(
      fmcScreen.renderer
    );
    fmcScreen.renderer.renderToDom = (...args) => {
      oldRenderToDom(...args);
      this.needsUpdate = true;
    };

    fmcScreen.attachPageExtension(
      wt21_fmc.UserSettingsPage,
      Wt21MobiflightCduUserSettingPageExtension
    );
    fmcScreen.addPluginPageRoute(
      "/mf-plugin/settings",
      Wt21MobiflightCduSettingsPage,
      undefined,
      null
    );
  }

  onSocketError() {
    if (
      this.socket.readyState === WebSocket.CLOSED &&
      Wt21MobiflightCduAvionicsPlugin.isEnabled.get()
    ) {
      setTimeout(this.connectHandler, 5000);
    }
  }

  connect() {
    this.socket = new WebSocket(this.socketUri);
    this.socket.onerror = this.onSocketErrorHandler;
    // this.socket.onclose = () => {
    //   console.log("[MF CDU plugin] disconnected.");
    //   if (Wt21MobiflightCduAvionicsPlugin.isEnabled.get()) {
    //     setTimeout(this.connectHandler, 5000);
    //   }
    // };
    this.socket.onopen = () => {
      console.log("[MF CDU plugin] connected.");
    };
  }

  disconnect() {
    if (this.isConnected()) {
        this.output.Data.forEach((c) => c.length = 0);
        this.socket.send(JSON.stringify(this.output));
        this.socket.close();
    }
  }

  isConnected() {
    return this.socket && this.socket.readyState === 1;
  }

  getColour(cellData) {
    for (let k of Wt21MobiflightCduAvionicsPlugin.colourMap.keys()) {
      if (cellData.styles.includes(k)) {
        return Wt21MobiflightCduAvionicsPlugin.colourMap.get(k);
      }
    }
    return MfColour.White;
  }

  onUpdate() {
    if (!this.needsUpdate || !this.isConnected()) {
      return;
    }
    this.needsUpdate = false;

    for (
      let r = 0;
      r < this.renderer.options.screenCellHeight && r < MF_CDU_ROWS;
      r++
    ) {
      for (
        let c = 0;
        c < this.renderer.options.screenCellWidth && c < MF_CDU_COLS;
        c++
      ) {
        this.copyWtColDataToOutput(r, c);
      }
    }

    // copy the bottom message to the scratchpad if the scratchpad isn't doing anything else
    if (
      this.isScratchpadBlank() &&
      Wt21MobiflightCduAvionicsPlugin.isShowMsgEnabled.get()
    ) {
      const bottomMessage = this.getBottomMessage();
      let outputIndex = this.getFirstScratchpadIndex();
      for (let i = 0; i < bottomMessage.length; i++, outputIndex++) {
        // we assume there were no special styles on the scratchpad ¯_(ツ)_/¯
        this.output.Data[outputIndex][0] = bottomMessage[i];
      }
    }

    this.socket.send(JSON.stringify(this.output));
  }

  getBottomMessage() {
    const row = this.renderer.options.screenCellHeight - 1;
    return this.renderer.columnData[row]
      .reduce((msg, cell) => (msg += cell.content), "")
      .replace(/EXEC$/, "")
      .trim();
  }

  copyWtColDataToOutput(rowIndex, colIndex) {
    const outputIndex = rowIndex * MF_CDU_COLS + colIndex;
    const cellData = this.renderer.columnData[rowIndex][colIndex];
    this.output.Data[outputIndex][0] = cellData.content.replace(
      Wt21MobiflightCduAvionicsPlugin.charRegex,
      (c) => Wt21MobiflightCduAvionicsPlugin.charMap[c]
    );
    this.output.Data[outputIndex][1] = this.getColour(cellData);
    this.output.Data[outputIndex][2] =
      (rowIndex % 2 === 1 && rowIndex !== MF_CDU_ROWS - 1) ||
      cellData.styles.includes("s-text")
        ? MfCharSize.Small
        : MfCharSize.Large;
  }

  getFirstScratchpadIndex() {
    return (MF_CDU_ROWS - 1) * MF_CDU_COLS + 1;
  }

  isScratchpadBlank() {
    const firstScratchpadIndex = this.getFirstScratchpadIndex();
    const lastScratchpadIndex = firstScratchpadIndex + MF_CDU_COLS - 2;
    for (let i = firstScratchpadIndex; i < lastScratchpadIndex; i++) {
      if (this.output.Data[i] && this.output.Data[i][0] != " ") {
        return false;
      }
    }
    return true;
  }
}
Wt21MobiflightCduAvionicsPlugin.colourMap = new Map([
  ["blue", MfColour.Cyan],
  ["green", MfColour.Green],
  ["disabled", MfColour.Grey],
  ["magenta", MfColour.Magenta],
  ["yellow", MfColour.Yellow],
  ["white", MfColour.White],
]);
Wt21MobiflightCduAvionicsPlugin.charMap = Object.freeze({
  "\xa0": " ",
  "□": "\u2610",
  "⬦": "°",
});
Wt21MobiflightCduAvionicsPlugin.charRegex = new RegExp(
  `[${Object.keys(Wt21MobiflightCduAvionicsPlugin.charMap).join("")}]`
);
Wt21MobiflightCduAvionicsPlugin.isEnabled = msfssdk.Subject.create(
  GetStoredData("tracernz_wt21_mf_cdu_enabled") === "0" ? 0 : 1
);
Wt21MobiflightCduAvionicsPlugin.isEnabled.sub(
  (v) => SetStoredData("tracernz_wt21_mf_cdu_enabled", v.toString()),
  false
);
Wt21MobiflightCduAvionicsPlugin.isShowMsgEnabled = msfssdk.Subject.create(
  GetStoredData("tracernz_wt21_mf_cdu_msg_enabled") === "0" ? 0 : 1
);
Wt21MobiflightCduAvionicsPlugin.isShowMsgEnabled.sub(
  (v) => SetStoredData("tracernz_wt21_mf_cdu_msg_enabled", v.toString()),
  false
);

class Wt21MobiflightCduUserSettingPageExtension extends msfssdk.AbstractFmcPageExtension {
  constructor(...args) {
    super(...args);
    this.settingsLinkField = msfssdk.PageLinkField.createLink(
      this.page,
      "<SETTINGS",
      "/mf-plugin/settings"
    );
  }
  onPageRendered(renderedTemplates) {
    renderedTemplates[0][9] = [" MOBIFLIGHT PLUGIN[blue]"];
    renderedTemplates[0][10] = [this.settingsLinkField];
  }
}

class Wt21MobiflightCduSettingsPage extends wt21_fmc.WT21FmcPage {
  constructor(...args) {
    super(...args);

    this.enabledField = new msfssdk.SwitchLabel(this, {
      optionStrings: ["DISABLED", "ENABLED"],
      activeStyle: "green",
    }).bind(Wt21MobiflightCduAvionicsPlugin.isEnabled);

    this.msgField = new msfssdk.SwitchLabel(this, {
      optionStrings: ["DISABLED", "ENABLED"],
      activeStyle: "green",
    }).bind(Wt21MobiflightCduAvionicsPlugin.isShowMsgEnabled);
  }
  render() {
    return [
      [
        ["", "", "MF SETTINGS[blue]"],
        [" ENABLED[blue]"],
        [this.enabledField],
        [" SHOW MSG IN SCRATCHPAD[blue]"],
        [this.msgField],
        [""],
        [""],
        [""],
        [""],
        [""],
        [""],
        ["", "", "------------------------[blue]"],
        [msfssdk.PageLinkField.createLink(this, "<SETTINGS", "/user-set")],
      ],
    ];
  }
}

msfssdk.registerPlugin(Wt21MobiflightCduAvionicsPlugin);
