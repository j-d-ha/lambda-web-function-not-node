#!/bin/sh
# Lambda's shim execve's this file as /var/task/server. The JVM is the
# interpreter here, the way python/bin/python3.13 is for the Python backend, so
# `exec` replaces the shell and no extra process is left behind.
#
# -XX:MaxRAMPercentage=75 because the Web Function environment is 2 GB and the
# JVM's container default (25%) would cap the heap at 512 MB.
exec /var/task/jre/bin/java -XX:MaxRAMPercentage=75 -jar /var/task/app.jar
