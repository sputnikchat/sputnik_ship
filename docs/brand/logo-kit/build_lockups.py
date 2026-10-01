"""Sputnik Ship lockups: Proa symbol + 'Sputnik Ship' set in Instrument Sans 600,
outlined (no live text), tracking -0.02em as in DESIGN.md."""
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from build_proa import proa

font=instantiateVariableFont(TTFont('/Users/cartola/Downloads/InstrumentSans-latin.woff2'),{'wght':600})
gs=font.getGlyphSet(); cmap=font.getBestCmap(); upm=font['head'].unitsPerEm
cap=font['OS/2'].sCapHeight
kern={}
# pair kerning from GPOS is complex; the -0.02em tracking + optical check is enough at this size

def word(text, size, x0, baseline):
    s=size/upm; track=-0.02*upm; x=0; paths=[]
    for ch in text:
        g=cmap[ord(ch)]
        pen=SVGPathPen(gs)
        gs[g].draw(TransformPen(pen,(s,0,0,-s,x0+x*s,baseline)))
        paths.append(pen.getCommands())
        x+=gs[g].width+track
    return " ".join(paths), (x-track)*s

GRAD=('<defs><linearGradient id="ss-g" x1="0" y1="0" x2="1" y2="1">'
      '<stop offset="0" stop-color="#8b7cf6"/><stop offset="1" stop-color="#5e6ad2"/></linearGradient></defs>')
SYM=proa()  # symbol spans x 42..214, y 22..222 in its 256 box (200 tall)

def horizontal(text_fill, sym_fill, name):
    H=256; sym_h=200; capsize=sym_h*0.40          # cap height = half the symbol
    size=capsize*upm/cap
    gap=52; x_text=214-42+gap
    baseline=22+sym_h/2+capsize/2                   # caps centred on the symbol
    d,w=word("Sputnik Ship",size,x_text,baseline)
    W=x_text+w+4
    svg=(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H}" width="{W:.0f}" height="{H}"><title>Sputnik Ship</title>{GRAD}'
         f'<path fill-rule="evenodd" fill="{sym_fill}" transform="translate(-42 0)" d="{SYM}"/>'
         f'<path fill="{text_fill}" d="{d}"/></svg>\n')
    open(name,'w').write(svg)

def stacked(text_fill, sym_fill, name):
    capsize=200*0.22; size=capsize*upm/cap
    d,w=word("Sputnik Ship",size,0,0)
    W=max(w,172); top=22; sym_bottom=222; gap=40
    baseline=sym_bottom+gap+capsize
    d,w=word("Sputnik Ship",size,(W-w)/2,baseline-top)
    H=baseline-top+capsize*0.42
    svg=(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" width="{W:.0f}" height="{H:.0f}"><title>Sputnik Ship</title>{GRAD}'
         f'<path fill-rule="evenodd" fill="{sym_fill}" transform="translate({(W-172)/2-42:.2f} {-top})" d="{SYM}"/>'
         f'<path fill="{text_fill}" d="{d}"/></svg>\n')
    open(name,'w').write(svg)

horizontal('#0b0c12','url(#ss-g)','sputnik-ship-horizontal.svg')
horizontal('#f2f3f7','url(#ss-g)','sputnik-ship-horizontal-on-dark.svg')
stacked('#0b0c12','url(#ss-g)','sputnik-ship-stacked.svg')
stacked('#f2f3f7','url(#ss-g)','sputnik-ship-stacked-on-dark.svg')
