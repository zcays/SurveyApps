import plotly.express as px
import numpy as np

img = np.random.rand(100, 100)
fig = px.imshow(img)
fig.update_yaxes(constrain="range")
fig.write_html("test.html")
