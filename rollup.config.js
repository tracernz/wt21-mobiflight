import copy from "rollup-plugin-copy";
import msfsLayout from "./scripts/rollup-plugin-msfs-layout.js";

export default [
  {
    input: "build/html_ui/Plugins/tracernz/wt21/wt21_cdu_mobiflight.js",
    output: {
      name: "wt21_cdu_mobiflight",
      file: "pkg/tracernz-plugin-wt21-mobiflight-cdu/html_ui/Plugins/tracernz/wt21/wt21_cdu_mobiflight.js",
      format: "iife",
      globals: {
        "@microsoft/msfs-sdk": "msfssdk",
        "@microsoft/msfs-wt21-fmc": "wt21_fmc",
        "@microsoft/msfs-wt21-shared": "wt21_shared",
      },
    },
    plugins: [
      copy({
        targets: [
          {
            src: "src/manifest.json",
            dest: "pkg/tracernz-plugin-wt21-mobiflight-cdu/",
          },
          {
            src: "src/html_ui/Plugins/tracernz-plugin-wt21-mobiflight-cdu.xml",
            dest: "pkg/tracernz-plugin-wt21-mobiflight-cdu/html_ui/Plugins/",
          },
        ],
      }),
      msfsLayout("pkg/tracernz-plugin-wt21-mobiflight-cdu"),
    ],
  },
];
