import sys

from analyzer import analyze
from builder import build
from dependency import graph
from splitter import main as split


def usage():

    print("""

TransportDesk Migration Tool

Commands

split

analyze

build

graph

""")


if len(sys.argv) < 2:
    usage()
    quit()

cmd = sys.argv[1].lower()

if cmd == "split":
    split()

elif cmd == "analyze":
    analyze()

elif cmd == "build":
    build()

elif cmd == "graph":
    graph()

else:
    usage()
