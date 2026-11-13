/* Rasterize the original SVG master at genuine output resolution. */
const fs=require('node:fs'),path=require('node:path');
const {Resvg}=require('@resvg/resvg-js');
const assets=path.join(__dirname,'../assets');
const svg=fs.readFileSync(path.join(assets,'icon.svg'));
for(const size of [1024,2048]) fs.writeFileSync(path.join(assets,size===1024?'icon.png':'icon-2048.png'),new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng());
