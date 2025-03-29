set shell := ["powershell.exe", "-c"]

build: layout

layout:
    d:/tools/MSFSLayoutGenerator.exe tracernz-plugin-wt21-mobiflight-cdu/layout.json
