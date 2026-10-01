"""Builds the Sputnik Ship 'Proa' mark: a prow (kite with notched base) and a
60° rhombus porthole cut as a real hole. Corners are rounded with true arcs."""
import math

def rounded(pts, radii):
    n=len(pts); out=[]
    for i,(p,r) in enumerate(zip(pts,radii)):
        a=pts[i-1]; b=pts[(i+1)%n]
        v1=(a[0]-p[0],a[1]-p[1]); v2=(b[0]-p[0],b[1]-p[1])
        l1=math.hypot(*v1); l2=math.hypot(*v2)
        u1=(v1[0]/l1,v1[1]/l1); u2=(v2[0]/l2,v2[1]/l2)
        ang=math.acos(max(-1,min(1,u1[0]*u2[0]+u1[1]*u2[1])))
        t=r/math.tan(ang/2)
        p1=(p[0]+u1[0]*t,p[1]+u1[1]*t); p2=(p[0]+u2[0]*t,p[1]+u2[1]*t)
        cross=u1[0]*u2[1]-u1[1]*u2[0]
        out.append((p1,p2,r,0 if cross>0 else 1))
    d=f"M{out[0][1][0]:.2f} {out[0][1][1]:.2f}"
    for p1,p2,r,sw in out[1:]+out[:1]:
        d+=f" L{p1[0]:.2f} {p1[1]:.2f} A{r} {r} 0 0 {sw} {p2[0]:.2f} {p2[1]:.2f}"
    return d+" Z"

def proa(diamond_w=28, diamond_cy=116):
    # prow: apex, right foot, notch (22.5° notch edges), left foot
    notch_y=222-86*math.tan(math.radians(22.5))
    outer=[(128,22),(214,222),(128,notch_y),(42,222)]
    h=diamond_w*math.tan(math.radians(60))
    dia=[(128,diamond_cy-h),(128+diamond_w,diamond_cy),(128,diamond_cy+h),(128-diamond_w,diamond_cy)]
    return rounded(outer,[11,11,7,11])+" "+rounded(dia,[3,3,3,3])

def svg(d, fill="#000", title="Sputnik Ship", defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
            f'<title>{title}</title>{defs}<path fill-rule="evenodd" fill="{fill}" d="{d}"/></svg>\n')

GRAD=('<defs><linearGradient id="ss-g" x1="0" y1="0" x2="1" y2="1">'
      '<stop offset="0" stop-color="#8b7cf6"/><stop offset="1" stop-color="#5e6ad2"/></linearGradient></defs>')

if __name__=="__main__":
    main=proa(); small=proa(diamond_w=34, diamond_cy=118)
    open("proa-symbol-black.svg","w").write(svg(main))
    open("proa-symbol-small.svg","w").write(svg(small, title="Sputnik Ship (small sizes)"))
    open("proa-symbol-color.svg","w").write(svg(main, fill="url(#ss-g)", defs=GRAD))
