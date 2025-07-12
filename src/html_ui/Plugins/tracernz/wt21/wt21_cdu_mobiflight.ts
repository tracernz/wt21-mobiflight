// Copyright (c) Michael Corcoran
// SPDX-License-Identifier: MIT

/// <reference types="@microsoft/msfs-types/js/datastorage" preserve="true" />

import {
    AbstractFmcPageExtension, ClockEvents, FmcColumnInformation, FmcRenderTemplate,
    MutableSubscribable, PageLinkField, registerPlugin, SimpleFmcRenderer, Subject, SwitchLabel
} from '@microsoft/msfs-sdk';
import {
    UserSettingsPage, WT21FmcAvionicsPlugin, WT21FmcPage, WT21FmcScreen
} from '@microsoft/msfs-wt21-fmc';

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

class Wt21MobiflightCduAvionicsPlugin extends WT21FmcAvionicsPlugin {
  private static readonly colourMap = new Map([
    ["blue", MfColour.Cyan],
    ["green", MfColour.Green],
    ["disabled", MfColour.Grey],
    ["magenta", MfColour.Magenta],
    ["yellow", MfColour.Yellow],
    ["white", MfColour.White],
  ]);

  private static readonly charMap: Record<string, string> = {
    "\xa0": " ",
    "□": "\u2610",
    "⬦": "°",
  } as const;

  private static readonly charRegex = new RegExp(
    `[${Object.keys(Wt21MobiflightCduAvionicsPlugin.charMap).join("")}]`
  );

  private readonly isEnabled = Subject.create(GetStoredData("tracernz_wt21_mf_cdu_enabled") === "0" ? 0 : 1);
  private readonly isShowMsgEnabled = Subject.create(
    GetStoredData("tracernz_wt21_mf_cdu_msg_enabled") === "0" ? 0 : 1
  );

  private readonly socketUri = !!this.binder.isPrimaryInstrument ? MF_CAPT : MF_FO;

  private renderer?: SimpleFmcRenderer;
  private socket?: WebSocket;

  private needsUpdate = false;
  private readonly output: {Target: string, Data: ([string, string, number] | [])[]} = {
    Target: "Display",
    Data: Array.from({ length: MF_CDU_ROWS * MF_CDU_COLS }, () => []),
  };

  onInstalled() {
    console.log("[MF CDU plugin] installed.");
    
    this.binder.bus
      .getSubscriber<ClockEvents>()
      .on("simTime")
      .atFrequency(4)
      .handle(this.onUpdate.bind(this));

    this.isEnabled.sub(
      (v) => (v ? this.connect() : this.disconnect()),
      true
    );
    this.isShowMsgEnabled.sub(
      () => (this.needsUpdate = true),
      false
    );

    this.isEnabled.sub(
      (v) => SetStoredData("tracernz_wt21_mf_cdu_enabled", v.toString()),
      false
    );
    this.isShowMsgEnabled.sub(
      (v) => SetStoredData("tracernz_wt21_mf_cdu_msg_enabled", v.toString()),
      false
    );
  }

  registerFmcExtensions(fmcScreen: WT21FmcScreen) {
    // Bit naughty to reach into its privates...
    this.renderer = (fmcScreen as any).renderer as SimpleFmcRenderer;
    const oldRenderToDom = (this.renderer as any).renderToDom.bind(
      this.renderer
    );
    (fmcScreen as any).renderer.renderToDom = (...args: unknown[]) => {
      oldRenderToDom(...args);
      this.needsUpdate = true;
    };

    fmcScreen.attachPageExtension(
      UserSettingsPage,
      Wt21MobiflightCduUserSettingPageExtension
    );
    fmcScreen.addPluginPageRoute(
      "/mf-plugin/settings",
      Wt21MobiflightCduSettingsPage,
      undefined,
      {
        isEnabled: this.isEnabled,
        isShowMsgEnabled: this.isShowMsgEnabled,
      }
    );
  }

  private onSocketError() {
    if (
      this.socket?.readyState === WebSocket.CLOSED &&
      this.isEnabled.get()
    ) {
      setTimeout(this.connectHandler, 5000);
    }
  }
  private readonly onSocketErrorHandler = this.onSocketError.bind(this);

  private connect() {
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
  private readonly connectHandler = this.connect.bind(this);

  disconnect() {
    if (this.isConnected() && this.socket) {
      this.output.Data.forEach((c) => c.length = 0);
      this.socket.send(JSON.stringify(this.output));
      this.socket.close();
    }
  }

  isConnected() {
    return this.socket && this.socket.readyState === 1;
  }

  getColour(cellData: FmcColumnInformation) {
    for (let k of Wt21MobiflightCduAvionicsPlugin.colourMap.keys()) {
      if (cellData.styles.includes(k)) {
        return Wt21MobiflightCduAvionicsPlugin.colourMap.get(k);
      }
    }
    return MfColour.White;
  }

  onUpdate() {
    if (!this.needsUpdate || !this.isConnected() || !this.renderer) {
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
      this.isShowMsgEnabled.get()
    ) {
      const bottomMessage = this.getBottomMessage();
      let outputIndex = this.getFirstScratchpadIndex();
      for (let i = 0; i < bottomMessage.length; i++, outputIndex++) {
        // we assume there were no special styles on the scratchpad ¯_(ツ)_/¯
        this.output.Data[outputIndex][0] = bottomMessage[i];
      }
    }

    this.socket?.send(JSON.stringify(this.output));
  }

  getBottomMessage(): string {
    if (!this.renderer) {
      return '';
    }
    const row = this.renderer.options.screenCellHeight - 1;
    // More privates
    return (this.renderer as any).columnData[row]
      .reduce((msg: string, cell: FmcColumnInformation) => (msg += cell.content), "")
      .replace(/EXEC$/, "")
      .trim();
  }

  copyWtColDataToOutput(rowIndex: number, colIndex: number): void {
    if (!this.renderer) {
      return;
    }
    const outputIndex = rowIndex * MF_CDU_COLS + colIndex;
    // More privates
    const cellData = (this.renderer as any).columnData[rowIndex][colIndex];
    this.output.Data[outputIndex][0] = cellData.content.replace(
      Wt21MobiflightCduAvionicsPlugin.charRegex,
      (c: string) => Wt21MobiflightCduAvionicsPlugin.charMap[c]
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

class Wt21MobiflightCduUserSettingPageExtension extends AbstractFmcPageExtension<UserSettingsPage> {
  private readonly settingsLinkField = PageLinkField.createLink(
    this.page,
    "<SETTINGS",
    "/mf-plugin/settings"
  );

  onPageRendered(renderedTemplates: FmcRenderTemplate[]): void {
    renderedTemplates[0][9] = [" MOBIFLIGHT PLUGIN[blue]"];
    renderedTemplates[0][10] = [this.settingsLinkField];
  }
}

interface Wt21MobiflightCduSettingsPageProps {
  isEnabled: MutableSubscribable<number>;
  isShowMsgEnabled: MutableSubscribable<number>;
}

class Wt21MobiflightCduSettingsPage extends WT21FmcPage<Wt21MobiflightCduSettingsPageProps> {
  private readonly enabledField = new SwitchLabel(this, {
    optionStrings: ["DISABLED", "ENABLED"],
    activeStyle: "green",
  }).bind(this.props.isEnabled);

  private readonly msgField = new SwitchLabel(this, {
    optionStrings: ["DISABLED", "ENABLED"],
    activeStyle: "green",
  }).bind(this.props.isShowMsgEnabled);

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
        [PageLinkField.createLink(this, "<SETTINGS", "/user-set")],
      ],
    ];
  }
}

registerPlugin(Wt21MobiflightCduAvionicsPlugin);
