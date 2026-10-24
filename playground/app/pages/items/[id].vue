<script setup lang="ts">
const route = useRoute();
// Fetched in-process during server rendering, so its route mustn't name the page's span.
const { data } = await useFetch(`/api/items/${route.params.id}`);
</script>

<template>
    <h1>Item {{ data?.id }}</h1>
</template>
