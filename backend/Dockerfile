# The Spring API as a local container (docs/local/CONTAINERS.md). Development-only: no production hardening.
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package && cp target/bee-api.jar /bee-api.jar

FROM eclipse-temurin:17-jre
RUN useradd --system --uid 10001 bee
COPY --from=build /bee-api.jar /app/bee-api.jar
USER bee
WORKDIR /app
EXPOSE 8090
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/bee-api.jar"]
