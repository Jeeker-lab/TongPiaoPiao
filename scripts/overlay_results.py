import io, json, sys
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

src,data_path,out=sys.argv[1:4]
data=json.load(open(data_path,encoding='utf-8')); counts=data['summary']['counts']
reader=PdfReader(src); page=reader.pages[0]; W=float(page.mediabox.width); H=float(page.mediabox.height)
buf=io.BytesIO(); pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light')); c=canvas.Canvas(buf,pagesize=(W,H))
c.setFillColorRGB(.02,.48,.34); c.roundRect(W-190,H-67,155,34,8,fill=1,stroke=0); c.setFillColorRGB(1,1,1); c.setFont('STSong-Light',12); c.drawCentredString(W-112,H-55,f"统计结果 · {data['summary']['valid']} 张有效票")
first=next(iter(data['results']),{}); options=first.get('options',[])
for opt in options:
    x,y,w,h=opt.get('bbox',[.7,.3,.05,.05]); px=x*W; py=H-(y+h/2)*H
    c.setFillColorRGB(.02,.48,.34); c.circle(px+w*W+25,py,13,fill=1,stroke=0); c.setFillColorRGB(1,1,1); c.setFont('STSong-Light',10); c.drawCentredString(px+w*W+25,py-3,str(counts.get(opt['label'],0)))
c.setFillColorRGB(.1,.25,.22); c.setFont('STSong-Light',9); c.drawRightString(W-35,22,'智能选票系统自动汇总 · 请对低置信度选票完成人工复核')
c.save(); buf.seek(0); overlay=PdfReader(buf).pages[0]; page.merge_page(overlay)
writer=PdfWriter(); writer.add_page(page)
with open(out,'wb') as f: writer.write(f)
