export const DEMO_PROJECT_ID = "local-demo-project";

export const DEMO_FILES = [
  {
    path: "main.tex",
    type: "tex",
    content: `\\documentclass{article}
\\usepackage{graphicx}
\\usepackage{natbib}
\\usepackage{hyperref}

\\title{Deep Learning Survey: A Comprehensive Overview}
\\author{Alove Redesign}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
This survey explores the landscape of deep learning, focusing on neural network architectures, optimization strategies, and recent advancements in generative models.
\\end{abstract}

\\section{Introduction}
Deep learning has revolutionized machine learning. As discussed by \\citet{lecun2015deep}, it enables computational models that are composed of multiple processing layers to learn representations of data with multiple levels of abstraction.

\\section{Architectures}
\\subsection{Convolutional Neural Networks}
CNNs are primarily used for image processing. They were popularized by AlexNet \\citep{krizhevsky2012imagenet}.

\\subsection{Transformers}
Transformers, introduced by \\citet{vaswani2017attention}, have become the de facto standard for NLP tasks.

\\bibliographystyle{plainnat}
\\bibliography{refs}

\\end{document}
`,
  },
  {
    path: "refs.bib",
    type: "bib",
    content: `@article{lecun2015deep,
  title={Deep learning},
  author={LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal={nature},
  volume={521},
  number={7553},
  pages={436--444},
  year={2015},
  publisher={Nature Publishing Group}
}

@inproceedings{krizhevsky2012imagenet,
  title={Imagenet classification with deep convolutional neural networks},
  author={Krizhevsky, Alex and Sutskever, Ilya and Hinton, Geoffrey E},
  booktitle={Advances in neural information processing systems},
  pages={1097--1105},
  year={2012}
}

@inproceedings{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N and Kaiser, {\\L}ukasz and Polosukhin, Illia},
  booktitle={Advances in neural information processing systems},
  pages={5998--6008},
  year={2017}
}
`,
  },
  {
    path: "figures",
    type: "folder",
    content: "",
  },
];
